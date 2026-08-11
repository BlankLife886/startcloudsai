import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAuthenticatedMediaBlob,
  getCachedAuthenticatedMediaBlob,
} from "@legacy/services/authenticatedMedia.js";
import "@legacy/features/ai-wallpaper/components/LocalMaskEditorDialog.vue?react-style";

const QUICK_PROMPTS = [
  { label: "移除内容", text: "移除选中区域的内容，并自然补全背景" },
  { label: "替换为…", text: "把选中区域替换为：" },
  {
    label: "重绘细节",
    text: "在保持构图与光影不变的前提下重绘选中区域，让细节更清晰",
  },
  {
    label: "更换颜色",
    text: "把选中区域改为新的颜色，保持材质、纹理和光影不变",
  },
];

const MAX_MASK_WORK_EDGE = 1600;
const IS_MAC = /mac|iphone|ipad/i.test(
  navigator.platform || navigator.userAgent || "",
);
const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

export function EcommerceMaskEditor({
  sourceUrl,
  sourceTitle = "未命名图片",
  busy = false,
  onClose,
  onSubmit,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const activeStrokeRef = useRef(null);
  const strokesRef = useRef([]);
  const redoStrokesRef = useRef([]);
  const coverageCanvasRef = useRef(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [brief, setBrief] = useState("");
  const [brushMode, setBrushMode] = useState("paint");
  const [brushSize, setBrushSize] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [coverage, setCoverage] = useState(0);
  const [, setHistoryVersion] = useState(0);
  const [cursor, setCursor] = useState({ visible: false, x: 0, y: 0, size: 0 });
  const [error, setError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const ratio =
    imageSize.width && imageSize.height
      ? imageSize.width / imageSize.height
      : 16 / 9;
  const artboardWidth = useMemo(() => {
    if (typeof window === "undefined") return 900;
    return (
      Math.max(
        260,
        Math.min(window.innerWidth - 408, (window.innerHeight - 182) * ratio),
      ) * zoom
    );
  }, [ratio, zoom]);
  const painted = strokesRef.current.length > 0;
  const canRedo = redoStrokesRef.current.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setError("");
    setImageUrl("");
    const cached = getCachedAuthenticatedMediaBlob(sourceUrl);
    Promise.resolve(
      cached ||
        fetchAuthenticatedMediaBlob(sourceUrl, {
          cache: "default",
          signal: controller.signal,
        }),
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((loadError) => {
        if (loadError?.name !== "AbortError") setError("原图读取失败，请重试");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl, loadVersion]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      const editable =
        event.target?.tagName === "TEXTAREA" ||
        event.target?.tagName === "INPUT" ||
        event.target?.isContentEditable;
      const modifier = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        void submit();
        return;
      }
      if (editable) return;
      if (modifier && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && (event.key === "y" || event.key === "Y")) {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier) return;
      if (event.key === "b" || event.key === "B") setBrushMode("paint");
      else if (event.key === "e" || event.key === "E") setBrushMode("erase");
      else if (event.key === "[")
        setBrushSize((value) => Math.max(12, value - 8));
      else if (event.key === "]")
        setBrushSize((value) => Math.min(160, value + 8));
      else if (event.key === "+" || event.key === "=")
        setZoom((value) => Math.min(3, value + 0.25));
      else if (event.key === "-" || event.key === "_")
        setZoom((value) => Math.max(0.5, value - 0.25));
      else if (event.key === "0") setZoom(1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  function initializeCanvas(event) {
    const image = event.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = image.naturalWidth || 1024;
    const height = image.naturalHeight || 1024;
    const workScale = Math.min(1, MAX_MASK_WORK_EDGE / Math.max(width, height));
    setImageSize({ width, height });
    canvas.width = Math.max(1, Math.round(width * workScale));
    canvas.height = Math.max(1, Math.round(height * workScale));
    strokesRef.current = [];
    redoStrokesRef.current = [];
    setCoverage(0);
    setHistoryVersion((value) => value + 1);
    renderCanvas();
  }

  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect?.width || !rect?.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function configureContext(context, stroke, scale = 1, mask = false) {
    const painting = stroke.mode === "paint";
    context.globalCompositeOperation = mask
      ? painting
        ? "destination-out"
        : "source-over"
      : painting
        ? "source-over"
        : "destination-out";
    context.strokeStyle = mask ? "#fff" : "rgba(91, 124, 255, 0.56)";
    context.fillStyle = context.strokeStyle;
    context.lineWidth = Math.max(1, stroke.size * scale);
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  function drawSegment(context, from, to, size) {
    if (from.x === to.x && from.y === to.y) {
      context.beginPath();
      context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function replay(context, strokes, scale = 1, mask = false) {
    strokes.forEach((stroke) => {
      context.save();
      configureContext(context, stroke, scale, mask);
      stroke.points.forEach((next, index) => {
        const previous = stroke.points[index - 1] || next;
        drawSegment(
          context,
          { x: previous.x * scale, y: previous.y * scale },
          { x: next.x * scale, y: next.y * scale },
          stroke.size * scale,
        );
      });
      context.restore();
    });
  }

  function renderCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    replay(context, strokesRef.current);
  }

  function start(event) {
    if (busy || !imageUrl) return;
    const next = point(event);
    if (!next) return;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    redoStrokesRef.current = [];
    const mode = event.altKey
      ? brushMode === "paint"
        ? "erase"
        : "paint"
      : brushMode;
    const stroke = { mode, size: brushSize, points: [next] };
    activeStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    const context = canvasRef.current.getContext("2d");
    context.save();
    configureContext(context, stroke);
    drawSegment(context, next, next, brushSize);
    context.restore();
    setHistoryVersion((value) => value + 1);
  }

  function move(event) {
    trackCursor(event);
    const stroke = activeStrokeRef.current;
    if (!drawingRef.current || !stroke || busy) return;
    const next = point(event);
    if (!next) return;
    const previous = stroke.points.at(-1);
    if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < 1.5)
      return;
    stroke.points.push(next);
    const context = canvasRef.current.getContext("2d");
    context.save();
    configureContext(context, stroke);
    drawSegment(context, previous || next, next, stroke.size);
    context.restore();
  }

  function stop(event) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    activeStrokeRef.current = null;
    event?.currentTarget?.releasePointerCapture?.(event.pointerId);
    updateCoverage();
  }

  function trackCursor(event) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const board = event.currentTarget?.parentElement?.getBoundingClientRect?.();
    if (!canvas || !rect?.width || !board) return;
    const size = Math.max(8, brushSize * (rect.width / canvas.width));
    setCursor({
      visible: true,
      x: event.clientX - board.left,
      y: event.clientY - board.top,
      size,
    });
  }

  function updateCoverage() {
    const source = canvasRef.current;
    if (!source || !strokesRef.current.length) {
      setCoverage(0);
      return;
    }
    let sample = coverageCanvasRef.current;
    if (!sample) {
      sample = document.createElement("canvas");
      coverageCanvasRef.current = sample;
    }
    sample.width = 128;
    sample.height = Math.max(
      1,
      Math.round((128 * source.height) / source.width),
    );
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, sample.width, sample.height);
    context.drawImage(source, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let covered = 0;
    for (let index = 3; index < pixels.length; index += 4)
      if (pixels[index] > 16) covered += 1;
    setCoverage((covered / (sample.width * sample.height)) * 100);
  }

  function undo() {
    if (busy || !strokesRef.current.length) return;
    const stroke = strokesRef.current.at(-1);
    strokesRef.current = strokesRef.current.slice(0, -1);
    redoStrokesRef.current = [...redoStrokesRef.current, stroke];
    renderCanvas();
    updateCoverage();
    setHistoryVersion((value) => value + 1);
  }

  function redo() {
    if (busy || !redoStrokesRef.current.length) return;
    const stroke = redoStrokesRef.current.at(-1);
    redoStrokesRef.current = redoStrokesRef.current.slice(0, -1);
    strokesRef.current = [...strokesRef.current, stroke];
    renderCanvas();
    updateCoverage();
    setHistoryVersion((value) => value + 1);
  }

  function clear() {
    if (busy || !strokesRef.current.length) return;
    redoStrokesRef.current = [
      ...redoStrokesRef.current,
      ...strokesRef.current.slice().reverse(),
    ];
    strokesRef.current = [];
    renderCanvas();
    updateCoverage();
    setHistoryVersion((value) => value + 1);
  }

  function applyQuickPrompt(text) {
    setBrief((current) => {
      const trimmed = current.trim();
      if (!trimmed) return text;
      return trimmed.includes(text) ? current : `${trimmed}\n${text}`;
    });
  }

  function createMaskFile() {
    return new Promise((resolve, reject) => {
      const source = canvasRef.current;
      if (!source || !imageSize.width || !imageSize.height) {
        reject(new Error("当前图片无法创建蒙版"));
        return;
      }
      const output = document.createElement("canvas");
      output.width = imageSize.width;
      output.height = imageSize.height;
      const context = output.getContext("2d", { alpha: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, output.width, output.height);
      replay(context, strokesRef.current, output.width / source.width, true);
      output.toBlob((blob) => {
        output.width = 1;
        output.height = 1;
        if (!blob) {
          reject(new Error("蒙版 PNG 生成失败"));
          return;
        }
        resolve(
          new File([blob], `ecommerce-mask-${Date.now()}.png`, {
            type: "image/png",
          }),
        );
      }, "image/png");
    });
  }

  async function submit() {
    if (!painted || !brief.trim() || busy) return;
    try {
      setError("");
      onSubmit?.({ brief: brief.trim(), maskFile: await createMaskFile() });
    } catch (submitError) {
      setError(submitError?.message || "蒙版生成失败");
    }
  }

  function handleZoomWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((value) =>
      Math.min(3, Math.max(0.5, value + (event.deltaY < 0 ? 0.1 : -0.1))),
    );
  }

  return (
    <div
      className="local-mask-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section
        className="local-mask-dialog is-light"
        role="dialog"
        aria-modal="true"
        aria-label="局部编辑"
      >
        <header className="local-mask-header">
          <div className="local-mask-heading">
            <span className="local-mask-heading-icon">
              <i className="bi bi-bounding-box-circles" />
            </span>
            <div>
              <strong>局部编辑</strong>
              <small>{sourceTitle}</small>
            </div>
          </div>
          <div className="local-mask-header-meta">
            {imageSize.width > 0 && (
              <span className="local-mask-source-size">
                <i className="bi bi-aspect-ratio" />
                {imageSize.width}×{imageSize.height}
              </span>
            )}
            {coverage > 0 && (
              <span className="local-mask-header-coverage">
                已选择 {coverage < 0.1 ? "<0.1%" : `${coverage.toFixed(1)}%`}
              </span>
            )}
          </div>
          <button
            type="button"
            className="local-mask-close"
            aria-label="关闭局部编辑"
            disabled={busy}
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <div className="local-mask-workspace">
          <div className="local-mask-stage">
            <div
              className="local-mask-toolbar"
              role="toolbar"
              aria-label="蒙版工具"
            >
              <div className="local-mask-seg" role="group">
                <button
                  type="button"
                  className={brushMode === "paint" ? "is-on" : ""}
                  aria-pressed={brushMode === "paint"}
                  disabled={busy}
                  title="涂抹区域（B）"
                  onClick={() => setBrushMode("paint")}
                >
                  <i className="bi bi-brush" />
                  <span>画笔</span>
                </button>
                <button
                  type="button"
                  className={brushMode === "erase" ? "is-on" : ""}
                  aria-pressed={brushMode === "erase"}
                  disabled={busy}
                  title="擦除蒙版（E）"
                  onClick={() => setBrushMode("erase")}
                >
                  <i className="bi bi-eraser" />
                  <span>擦除</span>
                </button>
              </div>
              <i className="local-mask-divider" />
              <div
                className="local-mask-sizer"
                title="画笔大小（[ 缩小 / ] 放大）"
              >
                <i className="bi bi-circle-fill is-min" />
                <input
                  type="range"
                  min="12"
                  max="160"
                  step="2"
                  value={brushSize}
                  disabled={busy}
                  aria-label="画笔大小"
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
                <output>{brushSize} px</output>
              </div>
              <i className="local-mask-divider" />
              <div
                className="local-mask-icons"
                role="group"
                aria-label="蒙版历史"
              >
                <button
                  type="button"
                  disabled={!painted || busy}
                  aria-label="撤销蒙版"
                  title={`撤销（${MOD_KEY_LABEL}Z）`}
                  onClick={undo}
                >
                  <i className="bi bi-arrow-counterclockwise" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo || busy}
                  aria-label="重做蒙版"
                  title={`重做（${MOD_KEY_LABEL}⇧Z）`}
                  onClick={redo}
                >
                  <i className="bi bi-arrow-clockwise" />
                </button>
                <button
                  type="button"
                  disabled={!painted || busy}
                  aria-label="重置蒙版"
                  onClick={clear}
                >
                  <i className="bi bi-arrow-repeat" />
                </button>
              </div>
              <span className="local-mask-toolbar-spacer" />
              <div
                className="local-mask-view-tools"
                role="group"
                aria-label="视图控制"
              >
                <button
                  type="button"
                  disabled={zoom <= 0.5}
                  aria-label="缩小画布"
                  onClick={() =>
                    setZoom((value) => Math.max(0.5, value - 0.25))
                  }
                >
                  <i className="bi bi-zoom-out" />
                </button>
                <output>{Math.round(zoom * 100)}%</output>
                <button
                  type="button"
                  disabled={zoom >= 3}
                  aria-label="放大画布"
                  onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                >
                  <i className="bi bi-zoom-in" />
                </button>
                <button
                  type="button"
                  aria-label="适应画布"
                  onClick={() => setZoom(1)}
                >
                  <i className="bi bi-arrows-fullscreen" />
                </button>
                <i className="local-mask-divider" />
                <button type="button" className="local-mask-compare" disabled>
                  <i className="bi bi-layout-split" />
                  <span>等待结果</span>
                </button>
              </div>
            </div>
            <div
              className="local-mask-stage-viewport"
              onWheel={handleZoomWheel}
            >
              <div className="local-mask-viewport-content">
                <div
                  className={`local-mask-artboard${brushMode === "erase" ? " is-erasing" : ""}`}
                  style={{
                    width: artboardWidth,
                    height: artboardWidth / ratio,
                  }}
                >
                  {error && !imageUrl ? (
                    <div className="local-mask-loading is-error">
                      <i className="bi bi-exclamation-triangle" />
                      <span>{error}</span>
                      <button
                        type="button"
                        className="local-mask-retry"
                        onClick={() => setLoadVersion((value) => value + 1)}
                      >
                        <i className="bi bi-arrow-clockwise" />
                        重新加载
                      </button>
                    </div>
                  ) : imageUrl ? (
                    <>
                      <img
                        className="local-mask-source-image"
                        src={imageUrl}
                        alt="局部编辑原图"
                        draggable="false"
                        onLoad={initializeCanvas}
                      />
                      <canvas
                        ref={canvasRef}
                        aria-label="局部编辑蒙版画布"
                        onPointerDown={start}
                        onPointerMove={move}
                        onPointerUp={stop}
                        onPointerCancel={stop}
                        onPointerLeave={() =>
                          setCursor((value) => ({ ...value, visible: false }))
                        }
                      />
                      {cursor.visible && !busy && (
                        <div
                          className={`local-mask-cursor${brushMode === "erase" ? " is-erase" : ""}`}
                          style={{
                            left: cursor.x,
                            top: cursor.y,
                            width: cursor.size,
                            height: cursor.size,
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="local-mask-loading">
                      <i className="bi bi-arrow-repeat spin" />
                      <span>正在读取原图...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="local-mask-stage-footer">
              <span>
                <i className="local-mask-dot" />
                蒙版区域
              </span>
              <span>
                <i className="bi bi-mouse" />B 涂抹 · E 擦除 · [ ] 画笔 · + -
                缩放 · 0 适应 · {MOD_KEY_LABEL}Z 撤销
              </span>
            </div>
          </div>
          <aside className={busy ? "is-busy" : ""}>
            <div className="local-mask-aside-heading">
              <span className="local-mask-step">01</span>
              <div>
                <strong>描述修改内容</strong>
                <small>仅对选中的区域生效</small>
              </div>
            </div>
            <div className="local-mask-prompt-field">
              <textarea
                className="local-mask-textarea"
                rows="8"
                maxLength={2000}
                value={brief}
                disabled={busy}
                placeholder="例如：把选中区域的衣服改为深蓝色皮夹克"
                onChange={(event) => setBrief(event.target.value)}
              />
              <span>{brief.length}/2000</span>
            </div>
            <div
              className="local-mask-quick"
              role="group"
              aria-label="快捷修改要求"
            >
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  disabled={busy}
                  onClick={() => applyQuickPrompt(prompt.text)}
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <div className="local-mask-preserve-note">
              <i className="bi bi-shield-check" />
              <div>
                <strong>默认保持原图视觉</strong>
                <p>
                  不会主动改变整图风格、颜色、光影与构图，除非你的要求中明确提出。
                </p>
              </div>
            </div>
            {error && imageUrl && (
              <p className="local-mask-error" role="alert">
                <i className="bi bi-exclamation-circle" />
                {error}
              </p>
            )}
            <div className="local-mask-footer">
              <span
                className={`local-mask-coverage${painted ? "" : " is-empty"}`}
              >
                {painted ? (
                  <>
                    <i className="bi bi-bounding-box" />
                    选中区域{" "}
                    {coverage < 0.1 ? "<0.1%" : `${coverage.toFixed(1)}%`}
                  </>
                ) : (
                  "尚未涂抹区域"
                )}
              </span>
              <button
                type="button"
                className="local-mask-submit"
                disabled={!painted || !brief.trim() || busy}
                onClick={submit}
              >
                <i
                  className={`bi ${busy ? "bi-arrow-repeat spin" : "bi-stars"}`}
                />
                {busy ? "正在提交..." : "生成局部编辑"}
                <kbd>{MOD_KEY_LABEL}↵</kbd>
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
