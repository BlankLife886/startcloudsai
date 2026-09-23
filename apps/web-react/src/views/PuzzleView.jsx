import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BASE_BOARD_WIDTH,
  COLLAGE_CATEGORIES,
  CUSTOM_RATIO_ID,
  FILTER_PRESETS,
  RATIO_PRESETS,
  TEXT_POSITIONS,
  buildBackgroundCss,
  buildFilterCss,
  computeCellRect,
  computeImageDrawRect,
  exportCollage,
  filterTemplates,
  getFilterPresetById,
  isDarkBackground,
  parsePixelSize,
  parseRatioPart,
  ratioPartsFromValue,
  resolveBoardRatio,
} from "@react/legacy-modules/features/ai-puzzle/domain/collageTemplates.js";
import "@react/legacy-static/features/ai-puzzle/styles/collage-studio.css";
import { useCollageEditor } from "../features/puzzle/useCollageEditor.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { DownloadIcon } from "../components/common/DownloadIcon.jsx";

const EXPORT_SIZES = [
  { label: "1600", value: 1600 },
  { label: "2400", value: 2400 },
  { label: "3600", value: 3600 },
];

const CANVAS_DENSITY = [
  { id: "tight", label: "紧凑", gap: 4, radius: 2, padding: 0 },
  { id: "regular", label: "适中", gap: 8, radius: 6, padding: 0 },
  { id: "loose", label: "宽松", gap: 16, radius: 16, padding: 16 },
];

const INSPIRATION_IMAGES = [
  ["landscape", "风景", "/sucai/profile-dark-landscape.png"],
  ["wallpaper-blue", "蓝色壁纸", "/sucai/ai-wallpaper-server-459defa9-9acc-4f92-8d1b-9a6b8e96fdec-1.webp"],
  ["wallpaper-color", "多彩壁纸", "/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.webp"],
  ["character", "角色", "/sucai/game-character-1785420271150.webp"],
  ["character-alt", "人物", "/sucai/game-character-1785420185589.webp"],
  ["game-ui", "游戏界面", "/sucai/game-ui-1785420083438.webp"],
  ["game-prop", "游戏道具", "/sucai/game-prop-1785420109672.webp"],
  ["model-sheet", "模型设定", "/sucai/ultra-model-sheet-board-1785420340076.webp"],
  ["ui-design", "界面设计", "/sucai/ui-design-1785420316960.webp"],
  ["wireframe", "线框场景", "/game-art/wireframe-horizon.jpg"],
].map(([id, label, src]) => ({ id, label, src }));

function Icon({ name, className = "" }) {
  return <i className={`bi bi-${name}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

function DraftNumberInput({ value, ariaLabel, inputRef, integer = false, parse, onCommit }) {
  const nodeRef = useRef(null);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const attachRef = (node) => {
    nodeRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

  useEffect(() => {
    if (!focusedRef.current && nodeRef.current) nodeRef.current.value = String(value);
  }, [value]);

  const sanitize = (raw) => String(raw ?? "").replace(integer ? /[^\d]/g : /[^\d.]/g, "");

  const commit = (raw) => {
    const current = valueRef.current;
    const n = Number(sanitize(raw));
    if (!Number.isFinite(n) || n <= 0) {
      if (nodeRef.current) nodeRef.current.value = String(current);
      return;
    }
    const next = parse(n, current);
    if (nodeRef.current) nodeRef.current.value = String(next);
    if (next !== current) onCommit(next, { history: false });
  };

  return (
    <input
      ref={attachRef}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      defaultValue={String(value)}
      onFocus={(event) => {
        focusedRef.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const next = sanitize(event.target.value);
        if (event.target.value !== next) event.target.value = next;
        const n = Number(next);
        if (!integer || !Number.isFinite(n) || n < 320 || n > 8192) return;
        if (n !== valueRef.current) onCommit(n, { history: false });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        commit(event.currentTarget.value);
      }}
    />
  );
}

function RatioPartInput(props) {
  return <DraftNumberInput {...props} parse={parseRatioPart} />;
}

function PixelSizeInput(props) {
  return <DraftNumberInput {...props} integer parse={parsePixelSize} />;
}

function TemplatePreview({ item }) {
  const ratio = item.ratio > 0 ? item.ratio : 1;
  const boardStyle = ratio >= 1
    ? { width: "100%", height: `${(1 / ratio) * 100}%` }
    : { width: `${ratio * 100}%`, height: "100%" };
  return (
    <div className="collage-template-preview">
      <div className="collage-template-preview__board" style={boardStyle}>
        {item.cells.map((cell) => (
          <span
            key={cell.id}
            style={{
              left: `calc(${cell.x * 100}% + 1px)`,
              top: `calc(${cell.y * 100}% + 1px)`,
              width: `calc(${cell.w * 100}% - 2px)`,
              height: `calc(${cell.h * 100}% - 2px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function PuzzleView() {
  const isDark = useIsDark();
  const editor = useCollageEditor({ darkPaper: isDark });
  const [sideTab, setSideTab] = useState("templates");
  const [inspectorTab, setInspectorTab] = useState("canvas");
  const [mobilePanel, setMobilePanel] = useState("canvas");
  const [categoryId, setCategoryId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inspirationQuery, setInspirationQuery] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("png");
  const [exportSizeMode, setExportSizeMode] = useState("preset");
  const [exportWidth, setExportWidth] = useState(2400);
  const [exportHeight, setExportHeight] = useState(2400);
  const [dragOverCell, setDragOverCell] = useState(-1);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [showBadges, setShowBadges] = useState(true);
  const [imageSizes, setImageSizes] = useState(() => new Map());
  const stageRef = useRef(null);
  const fileInputRef = useRef(null);
  const ownedUrls = useRef(new Set());
  const panRef = useRef(null);

  const filteredTemplates = useMemo(
    () => filterTemplates(categoryId, searchQuery),
    [categoryId, searchQuery],
  );
  const filteredInspirations = useMemo(() => {
    const query = inspirationQuery.trim().toLowerCase();
    return query
      ? INSPIRATION_IMAGES.filter((item) => item.label.toLowerCase().includes(query))
      : INSPIRATION_IMAGES;
  }, [inspirationQuery]);
  const boardHeight = BASE_BOARD_WIDTH / editor.boardRatio;
  const boardScale = editor.zoom / 100;
  const selectedCellState = editor.cells[editor.selectedCell] || null;

  const paperTone = isDarkBackground(editor.background) ? "is-dark-paper" : "is-light-paper";
  const densityId = CANVAS_DENSITY.find((item) => item.gap === editor.gap && item.radius === editor.radius && item.padding === editor.padding)?.id || "";
  const ratioParts = editor.ratioId === CUSTOM_RATIO_ID ? editor.customRatio : ratioPartsFromValue(editor.boardRatio);
  const ratioWidthRef = useRef(null);
  const exportWidthRef = useRef(null);
  const exportW = exportWidth;
  const exportH = exportSizeMode === "custom" ? exportHeight : Math.max(320, Math.round(exportWidth / editor.boardRatio));
  const exportSizeRef = useRef({ w: exportW, h: exportH });
  exportSizeRef.current = { w: exportW, h: exportH };

  const applyExportPixels = (w, h, options) => {
    const nextW = parsePixelSize(w, exportSizeRef.current.w);
    const nextH = parsePixelSize(h, exportSizeRef.current.h);
    exportSizeRef.current = { w: nextW, h: nextH };
    setExportSizeMode("custom");
    setExportWidth(nextW);
    setExportHeight(nextH);
    editor.setRatioFromValue(nextW / nextH, options);
  };

  const applyRatioId = (id) => {
    editor.setRatio(id);
    if (exportSizeMode === "custom") {
      const nextRatio = resolveBoardRatio(editor.template, id, editor.customRatio);
      setExportHeight(parsePixelSize(Math.round(exportWidth / nextRatio)));
    }
  };

  const applyRatioParts = (w, h, options) => {
    editor.setCustomRatio(w, h, options);
    if (exportSizeMode === "custom") {
      const nextW = parseRatioPart(w, ratioParts.w);
      const nextH = parseRatioPart(h, ratioParts.h);
      setExportHeight(parsePixelSize(Math.round(exportWidth * (nextH / nextW))));
    }
  };

  const fitZoom = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sizer = stage.querySelector(".collage-stage-sizer");
    const styles = getComputedStyle(sizer || stage);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const availableWidth = stage.clientWidth - padX;
    const availableHeight = stage.clientHeight - padY;
    if (availableWidth < 80 || availableHeight < 80) return;
    const scale = Math.min(availableWidth / BASE_BOARD_WIDTH, availableHeight / boardHeight);
    editor.setZoom(Math.max(30, Math.min(150, Math.floor((scale * 100) / 5) * 5)));
  }, [boardHeight, editor.setZoom]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    fitZoom();
    const observer = new ResizeObserver(() => fitZoom());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitZoom, editor.templateId, editor.ratioId, editor.customRatio]);

  useLayoutEffect(() => {
    if (editor.customBgColor) return;
    if (isDark && editor.backgroundId === "white") {
      editor.setBackground("black", { history: false });
    } else if (!isDark && editor.backgroundId === "black") {
      editor.setBackground("white", { history: false });
    }
  }, [isDark]);

  useEffect(() => {
    const urls = ownedUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const applyFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith("image/"));
      let firstSrc = "";
      files.forEach((file) => {
        const src = URL.createObjectURL(file);
        ownedUrls.current.add(src);
        editor.addUpload(src, file.name || "本地图片");
        if (!firstSrc) firstSrc = src;
      });
      if (firstSrc && files.length === 1) editor.assignImageSmart(firstSrc);
      if (files.length) {
        setSideTab("uploads");
        setMobilePanel(files.length === 1 ? "canvas" : "assets");
      }
    },
    [editor.addUpload, editor.assignImageSmart],
  );

  useEffect(() => {
    const onPaste = (event) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.type?.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      applyFiles(files);
    };
    const onKeyDown = (event) => {
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [applyFiles, editor.redo, editor.undo]);

  const cellRect = useCallback(
    (cell) => computeCellRect(cell, BASE_BOARD_WIDTH, boardHeight, editor.gap, editor.padding),
    [boardHeight, editor.gap, editor.padding],
  );

  const cellImageStyle = (cell, index) => {
    const state = editor.cells[index];
    if (!state?.src) return {};
    const filter = buildFilterCss(getFilterPresetById(state.filterId).params);
    const meta = imageSizes.get(state.src);
    if (!meta) return { width: "100%", height: "100%", objectFit: "cover", filter };
    const rect = cellRect(cell);
    const draw = computeImageDrawRect(meta.w, meta.h, { x: 0, y: 0, w: rect.w, h: rect.h }, state);
    return {
      position: "absolute",
      left: `${draw.x}px`,
      top: `${draw.y}px`,
      width: `${draw.w}px`,
      height: `${draw.h}px`,
      maxWidth: "none",
      filter,
    };
  };

  const onImageLoad = (event, src) => {
    const image = event.currentTarget;
    setImageSizes((current) => {
      const next = new Map(current);
      next.set(src, { w: image.naturalWidth || 1, h: image.naturalHeight || 1 });
      return next;
    });
  };

  const onCellPointerDown = (event, index) => {
    editor.setSelectedCell(index);
    const state = editor.cells[index];
    if (!state?.src) {
      panRef.current = { index, empty: true };
      setInspectorTab("cell");
      return;
    }
    setInspectorTab("cell");
    const meta = imageSizes.get(state.src);
    if (!meta) return;
    const rect = cellRect(editor.template.cells[index]);
    const draw = computeImageDrawRect(meta.w, meta.h, { x: 0, y: 0, w: rect.w, h: rect.h }, state);
    panRef.current = {
      index,
      startX: event.clientX,
      startY: event.clientY,
      baseOffsetX: state.offsetX || 0,
      baseOffsetY: state.offsetY || 0,
      maxShiftX: Math.max(0, (draw.w - rect.w) / 2),
      maxShiftY: Math.max(0, (draw.h - rect.h) / 2),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onCellPointerMove = (event) => {
    const pan = panRef.current;
    if (!pan || pan.empty) return;
    const dx = (event.clientX - pan.startX) / (boardScale || 1);
    const dy = (event.clientY - pan.startY) / (boardScale || 1);
    const patch = {};
    if (pan.maxShiftX >= 1) patch.offsetX = Math.max(-1, Math.min(1, pan.baseOffsetX + dx / pan.maxShiftX));
    if (pan.maxShiftY >= 1) patch.offsetY = Math.max(-1, Math.min(1, pan.baseOffsetY + dy / pan.maxShiftY));
    editor.updateCell(pan.index, patch, { history: false });
  };

  const onCellPointerUp = () => {
    if (panRef.current?.empty) {
      setSideTab("uploads");
      setInspectorTab("cell");
    }
    panRef.current = null;
  };

  const handleExport = async () => {
    if (!editor.filledCount || editor.exporting) return;
    setExportMenuOpen(false);
    editor.setExporting(true);
    try {
      const blob = await exportCollage({
        template: editor.template,
        ratioId: editor.ratioId,
        customRatio: editor.customRatio,
        cells: editor.cells,
        gap: editor.gap,
        radius: editor.radius,
        padding: editor.padding,
        background: editor.background,
        text: editor.caption,
        exportWidth: exportW,
        exportHeight: exportH,
        format: exportFormat,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `walleven-collage-${exportW}x${exportH}-${Date.now()}.${exportFormat === "jpeg" ? "jpg" : "png"}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      editor.setExporting(false);
    }
  };

  return (
    <main className={`collage-studio-page is-chamber${isDark ? "" : " is-light"}`}>
      <div className="collage-studio">
        <header className="collage-topbar">
          <div className="collage-topbar-right">
            <button type="button" className="collage-top-btn collage-add-btn" onClick={() => fileInputRef.current?.click()}><Icon name="plus-lg" /><span>添加图片</span></button>
            <button type="button" className="collage-top-btn" disabled={!editor.uploads.length} onClick={editor.autoFillFromUploads}><Icon name="grid-3x3-gap" /><span>自动填充</span></button>
            <button type="button" className="collage-top-btn" disabled={editor.filledCount < 2} onClick={editor.shuffleCells}><Icon name="shuffle" /><span>打乱</span></button>
            <div className="collage-export-group">
              <button type="button" className="collage-top-btn primary" disabled={editor.exporting || !editor.filledCount} onClick={handleExport}>{editor.exporting ? <Icon name="arrow-repeat" className="spin" /> : <DownloadIcon />}<span>{editor.exporting ? "导出中…" : "导出"}</span></button>
              <button type="button" className="collage-top-btn primary collage-export-caret" disabled={editor.exporting} onClick={() => setExportMenuOpen((open) => !open)}><Icon name="chevron-down" /></button>
              {exportMenuOpen && <div className="collage-export-menu">
                <div className="collage-export-menu__title">格式</div>
                <div className="collage-export-menu__row">{["png", "jpeg"].map((format) => <button key={format} type="button" className={exportFormat === format ? "active" : ""} onClick={() => setExportFormat(format)}>{format === "jpeg" ? "JPG" : "PNG"}</button>)}</div>
                <div className="collage-export-menu__title">尺寸</div>
                <div className="collage-export-menu__col">{EXPORT_SIZES.map((size) => <button key={size.value} type="button" className={exportSizeMode === "preset" && exportWidth === size.value ? "active" : ""} onClick={() => { setExportSizeMode("preset"); setExportWidth(size.value); }}>{size.label}</button>)}</div>
                <button type="button" className={exportSizeMode === "custom" ? "active" : ""} onClick={() => { applyExportPixels(exportW, exportH); exportWidthRef.current?.focus(); }}>自定义 {exportW}×{exportH}</button>
              </div>}
            </div>
          </div>
        </header>

        <nav className="collage-mobile-nav" aria-label="拼图工作区">
          {[["assets", "collection", "素材"], ["canvas", "bounding-box", "画布"], ["settings", "sliders", "调整"]].map(([id, icon, label]) => <button key={id} type="button" className={mobilePanel === id ? "active" : ""} onClick={() => setMobilePanel(id)}><Icon name={icon} /><span>{label}</span></button>)}
        </nav>

        <div className="collage-workspace">
          <aside className={`collage-sidebar${mobilePanel === "assets" ? " is-mobile-active" : ""}`}>
            <div className="collage-side-tabs">
              {[["templates", "grid-1x2", "模板"], ["uploads", "images", "素材"], ["inspiration", "stars", "灵感"]].map(([id, icon, label]) => <button key={id} type="button" className={sideTab === id ? "active" : ""} onClick={() => setSideTab(id)}><Icon name={icon} />{label}{id === "uploads" && editor.uploads.length > 0 && <em>{editor.uploads.length}</em>}</button>)}
            </div>
            <div className="collage-side-body">
              {sideTab === "templates" && <>
                <input className="collage-search" type="search" placeholder="搜索模板…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
                <div className="collage-category-pills">{COLLAGE_CATEGORIES.map((category) => <button key={category.id} type="button" className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)}>{category.label}</button>)}</div>
                <div className="collage-template-grid">{filteredTemplates.map((item) => <button key={item.id} type="button" className={`collage-template-card${editor.templateId === item.id ? " active" : ""}`} onClick={() => { editor.setTemplate(item.id); setMobilePanel("canvas"); }}><TemplatePreview item={item} /><span className="collage-template-copy"><em>{item.name}</em><small>{item.cells.length} 格</small></span></button>)}</div>
              </>}
              {sideTab === "uploads" && <>
                <div className={`collage-upload-zone${uploadDragOver ? " is-dragover" : ""}`} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setUploadDragOver(true); }} onDragLeave={() => setUploadDragOver(false)} onDrop={(event) => { event.preventDefault(); setUploadDragOver(false); applyFiles(event.dataTransfer.files); }}><Icon name="cloud-arrow-up" /><span>点击或拖拽上传图片</span><small>支持多选，图片仅在本机处理不会上传服务器</small></div>
                {editor.uploads.length > 0 ? <><p className="collage-hero-hint">点击素材填入当前格，或拖到画布；支持 Ctrl+V 粘贴图片。</p><div className="collage-material-actions"><button type="button" onClick={() => { editor.autoFillFromUploads(); setMobilePanel("canvas"); }}><Icon name="grid-3x3-gap" />自动填充空格</button><button type="button" disabled={editor.filledCount < 2} onClick={editor.shuffleCells}><Icon name="shuffle" />打乱顺序</button></div><div className="collage-upload-grid">{editor.uploads.map((item) => <div key={item.id} className="collage-upload-item" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", item.src); event.dataTransfer.setData("application/x-walleven-collage-src", item.src); }} onClick={() => { editor.assignImageSmart(item.src); setInspectorTab("cell"); setMobilePanel("canvas"); }}><img src={item.src} alt="" draggable={false} /><button type="button" title="移除" onClick={(event) => { event.stopPropagation(); editor.removeUpload(item.id); }}><Icon name="x" /></button></div>)}</div></> : <div className="collage-side-empty"><Icon name="images" /><span>还没有素材，先上传几张图片吧</span></div>}
              </>}
              {sideTab === "inspiration" && <>
                <div className="collage-wallpaper-toolbar"><input className="collage-search" type="search" placeholder="搜索灵感素材…" value={inspirationQuery} onChange={(event) => setInspirationQuery(event.target.value)} /></div>
                {filteredInspirations.length ? <div className="collage-wallpaper-grid">{filteredInspirations.map((item) => <button key={item.id} type="button" className="collage-wallpaper-item" draggable title={item.label} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.src)} onClick={() => { editor.addUpload(item.src, item.label); editor.assignImageSmart(item.src); setSideTab("uploads"); setMobilePanel("canvas"); }}><img src={item.src} alt={item.label} loading="lazy" draggable={false} /></button>)}</div> : <div className="collage-side-empty"><Icon name="search" /><span>没有匹配的灵感素材</span></div>}
              </>}
            </div>
          </aside>

          <section className={`collage-stage-wrap${mobilePanel === "canvas" ? " is-mobile-active" : ""}`}>
            <div ref={stageRef} className="collage-stage" onWheel={(event) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); editor.setZoom(Math.max(30, Math.min(150, editor.zoom + (event.deltaY > 0 ? -5 : 5)))); }}>
              <div className="collage-stage-sizer"><div className="collage-board-outer" style={{ width: `${BASE_BOARD_WIDTH * boardScale}px`, height: `${boardHeight * boardScale}px` }}><div className={`collage-board${editor.filledCount ? "" : " is-blank"} ${paperTone}${showBadges ? "" : " is-hide-badges"}`} style={{ width: `${BASE_BOARD_WIDTH}px`, height: `${boardHeight}px`, background: buildBackgroundCss(editor.background), transform: `scale(${boardScale})` }}>
                {editor.template.cells.map((cell, index) => { const rect = cellRect(cell); const filled = Boolean(editor.cells[index]?.src); return <div key={cell.id} className={`collage-cell${editor.selectedCell === index ? " selected" : ""}${dragOverCell === index ? " is-drop-target" : ""}${filled ? "" : " is-vacant"}`} style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, borderRadius: `${editor.radius}px` }} onPointerDown={(event) => onCellPointerDown(event, index)} onPointerMove={onCellPointerMove} onPointerUp={onCellPointerUp} onPointerCancel={onCellPointerUp} onDoubleClick={() => filled && editor.resetCellFraming(index)} onDragEnter={(event) => { event.preventDefault(); setDragOverCell(index); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragOverCell(-1)} onDrop={(event) => { event.preventDefault(); setDragOverCell(-1); const src = event.dataTransfer.getData("application/x-walleven-collage-src") || event.dataTransfer.getData("text/plain"); if (src) { editor.assignImageToCell(index, src); setInspectorTab("cell"); } else applyFiles(event.dataTransfer.files); }}><span className="collage-cell-badge">{index + 1}</span>{filled ? <img src={editor.cells[index].src} style={cellImageStyle(cell, index)} alt="" draggable={false} onLoad={(event) => onImageLoad(event, editor.cells[index].src)} /> : <div className="collage-cell-empty"><span className="collage-cell-empty__mark"><Icon name="plus-lg" /></span></div>}</div>; })}
                {editor.caption.enabled && editor.caption.content.trim() && <div className="collage-caption" style={{ fontSize: `${Math.max(12, (Number(editor.caption.size) / 100) * BASE_BOARD_WIDTH)}px`, color: editor.caption.color, textShadow: editor.caption.shadow ? "0 2px 12px rgba(0,0,0,.55)" : "none", ...(editor.caption.position === "top" ? { top: "5%", bottom: "auto" } : editor.caption.position === "center" ? { top: "50%", bottom: "auto", transform: "translateY(-50%)" } : { bottom: "5%", top: "auto" }) }}>{editor.caption.content}</div>}
              </div></div></div>
            </div>
            <div className="collage-stage-footer"><button type="button" className="collage-zoom-btn" title="适应窗口" onClick={fitZoom}><Icon name="aspect-ratio" /></button><input value={editor.zoom} type="range" min="30" max="150" step="5" onChange={(event) => editor.setZoom(Number(event.target.value))} /><output>{editor.zoom}%</output></div>
          </section>

          <aside className={`collage-inspector${mobilePanel === "settings" ? " is-mobile-active" : ""}`}>
            <div className="collage-inspector-head">
              <div className="collage-inspector-tabs">
                <button type="button" className={inspectorTab === "canvas" ? "active" : ""} onClick={() => setInspectorTab("canvas")}>画布</button>
                <button type="button" className={inspectorTab === "cell" ? "active" : ""} onClick={() => setInspectorTab("cell")}>格子</button>
              </div>
              <div className="collage-inspector-tools">
                <button type="button" title="撤销" disabled={!editor.canUndo} onClick={editor.undo}><Icon name="arrow-counterclockwise" /></button>
                <button type="button" title="重做" disabled={!editor.canRedo} onClick={editor.redo}><Icon name="arrow-clockwise" /></button>
              </div>
            </div>
            <div className="collage-inspector-body">
              {inspectorTab === "canvas" ? <>
                <div className="collage-field">
                  <span>比例</span>
                  <div className="collage-ratio-grid">
                    {RATIO_PRESETS.map((preset) => <button key={preset.id} type="button" className={editor.ratioId === preset.id ? "active" : ""} onClick={() => applyRatioId(preset.id)}>{preset.label === "模板默认" ? "默认" : preset.label}</button>)}
                    <button type="button" className={editor.ratioId === CUSTOM_RATIO_ID ? "active" : ""} onClick={() => { const parts = ratioPartsFromValue(editor.boardRatio); applyRatioParts(parts.w, parts.h, { forceCustom: true }); requestAnimationFrame(() => ratioWidthRef.current?.focus()); }}>自定义</button>
                  </div>
                  <div className="collage-ratio-custom">
                    <RatioPartInput inputRef={ratioWidthRef} value={ratioParts.w} ariaLabel="宽度比" onCommit={(w, options) => applyRatioParts(w, ratioParts.h, options)} />
                    <em>:</em>
                    <RatioPartInput value={ratioParts.h} ariaLabel="高度比" onCommit={(h, options) => applyRatioParts(ratioParts.w, h, options)} />
                    <button type="button" className="collage-ratio-swap" title="对调宽高" onClick={() => applyRatioParts(ratioParts.h, ratioParts.w)}><Icon name="arrow-left-right" /></button>
                  </div>
                </div>
                <div className="collage-field">
                  <span>疏密</span>
                  <div className="collage-seg">{CANVAS_DENSITY.map((item) => <button key={item.id} type="button" className={densityId === item.id ? "active" : ""} onClick={() => editor.applyCanvasStyle({ gap: item.gap, radius: item.radius, padding: item.padding })}>{item.label}</button>)}</div>
                  {[["间距", editor.gap, editor.setGap, 28, 1], ["圆角", editor.radius, editor.setRadius, 36, 1], ["边距", editor.padding, editor.setPadding, 48, 2]].map(([label, value, setter, max, step]) => <div className="collage-field-row" key={label}><em>{label}</em><input value={value} type="range" min="0" max={max} step={step} onChange={(event) => setter(Number(event.target.value))} /><output>{value}</output></div>)}
                </div>
                <div className="collage-field">
                  <span>背景</span>
                  <div className="collage-bg-grid">{editor.BACKGROUND_PRESETS.map((preset) => <button key={preset.id} type="button" title={preset.label} className={!editor.customBgColor && editor.backgroundId === preset.id ? "active" : ""} style={{ background: buildBackgroundCss(preset) }} onClick={() => editor.setBackground(preset.id)} />)}<label className={`collage-bg-custom${editor.customBgColor ? " active" : ""}`} title="自定义颜色"><Icon name="eyedropper" /><input type="color" value={editor.customBgColor || "#ffffff"} onChange={(event) => editor.setCustomBgColor(event.target.value)} /></label></div>
                </div>
                <div className="collage-field">
                  <span className="collage-field-toggle">标题<button type="button" className={`collage-switch${editor.caption.enabled ? " on" : ""}`} role="switch" aria-checked={editor.caption.enabled} aria-label="标题文字" onClick={() => editor.setCaption((caption) => ({ ...caption, enabled: !caption.enabled }))}><i /></button></span>
                  {editor.caption.enabled && <>
                    <input className="collage-search" type="text" maxLength="40" placeholder="输入标题…" value={editor.caption.content} onChange={(event) => editor.setCaption((caption) => ({ ...caption, content: event.target.value }), { history: false })} />
                    <div className="collage-text-row">
                      <div className="collage-seg collage-text-pos">{TEXT_POSITIONS.map((position) => <button key={position.id} type="button" className={editor.caption.position === position.id ? "active" : ""} onClick={() => editor.setCaption((caption) => ({ ...caption, position: position.id }))}>{position.label}</button>)}</div>
                      <input className="collage-text-color" type="color" title="文字颜色" value={editor.caption.color} onChange={(event) => editor.setCaption((caption) => ({ ...caption, color: event.target.value }))} />
                    </div>
                    <div className="collage-field-row"><em>字号</em><input value={editor.caption.size} type="range" min="3" max="10" step="0.5" onChange={(event) => editor.setCaption((caption) => ({ ...caption, size: Number(event.target.value) }), { history: false })} /><output>{editor.caption.size}</output></div>
                  </>}
                </div>
                <div className="collage-field">
                  <span>导出</span>
                  <div className="collage-seg">{["png", "jpeg"].map((format) => <button key={format} type="button" className={exportFormat === format ? "active" : ""} onClick={() => setExportFormat(format)}>{format === "jpeg" ? "JPG" : "PNG"}</button>)}</div>
                  <div className="collage-seg" style={{ marginTop: 6 }}>
                    {EXPORT_SIZES.map((size) => <button key={size.value} type="button" className={exportSizeMode === "preset" && exportWidth === size.value ? "active" : ""} onClick={() => { setExportSizeMode("preset"); setExportWidth(size.value); }}>{size.label}</button>)}
                  </div>
                  <div className="collage-ratio-custom collage-size-custom">
                    <PixelSizeInput inputRef={exportWidthRef} value={exportW} ariaLabel="导出宽度" onCommit={(w, options) => applyExportPixels(w, exportH, options)} />
                    <em>×</em>
                    <PixelSizeInput value={exportH} ariaLabel="导出高度" onCommit={(h, options) => applyExportPixels(exportW, h, options)} />
                    <span className="collage-size-unit">px</span>
                    <button type="button" className="collage-ratio-swap" title="对调宽高" onClick={() => applyExportPixels(exportH, exportW)}><Icon name="arrow-left-right" /></button>
                  </div>
                </div>
                <div className="collage-field">
                  <span className="collage-field-toggle">格号<button type="button" className={`collage-switch${showBadges ? " on" : ""}`} role="switch" aria-checked={showBadges} aria-label="格号" onClick={() => setShowBadges((value) => !value)}><i /></button></span>
                </div>
                <button type="button" className="collage-inspector-clear" disabled={!editor.filledCount} onClick={editor.clearAllCells}><Icon name="eraser" />清空画布</button>
              </> : <>
                <div className="collage-cell-nav">{editor.template.cells.map((cell, index) => <button key={cell.id} type="button" className={editor.selectedCell === index ? "active" : ""} onClick={() => editor.setSelectedCell(index)}>{index + 1}</button>)}</div>
                {selectedCellState?.src ? <>
                  <div className="collage-field">
                    <span>取景</span>
                    <div className="collage-field-row"><em>缩放</em><input value={selectedCellState.scale} type="range" min="1" max="3" step="0.05" onChange={(event) => editor.updateCell(editor.selectedCell, { scale: Number(event.target.value) }, { history: false })} /><output>{Math.round(selectedCellState.scale * 100)}</output></div>
                    <p className="collage-field-note">放大后可在画布上拖动构图</p>
                  </div>
                  <div className="collage-field">
                    <span>滤镜</span>
                    <div className="collage-filter-grid">{FILTER_PRESETS.map((preset) => <button key={preset.id} type="button" className={selectedCellState.filterId === preset.id ? "active" : ""} onClick={() => editor.setCellFilter(editor.selectedCell, preset.id)}><img src={selectedCellState.src} style={{ filter: buildFilterCss(preset.params) }} alt="" draggable={false} /><em>{preset.label}</em></button>)}</div>
                    <button type="button" className="collage-inspector-clear" onClick={() => editor.applyFilterToAll(selectedCellState.filterId)}>应用到全部格子</button>
                  </div>
                  <div className="collage-cell-actions">
                    <button type="button" onClick={() => editor.resetCellFraming(editor.selectedCell)}>重置取景</button>
                    <button type="button" disabled={editor.selectedCell <= 0} onClick={() => editor.swapCells(editor.selectedCell, editor.selectedCell - 1)}>与上一格对调</button>
                    <button type="button" disabled={editor.selectedCell >= editor.template.cells.length - 1} onClick={() => editor.swapCells(editor.selectedCell, editor.selectedCell + 1)}>与下一格对调</button>
                    <button type="button" onClick={() => editor.clearCell(editor.selectedCell)}>清空此格</button>
                  </div>
                </> : (
                  <div className="collage-side-empty collage-cell-empty-panel">
                    <Icon name="plus-lg" />
                    <span>第 {editor.selectedCell + 1} 格还是空的</span>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>添加图片</button>
                  </div>
                )}
              </>}
            </div>
          </aside>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { applyFiles(event.target.files); event.target.value = ""; }} />
      </div>
    </main>
  );
}
