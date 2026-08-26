import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import "./WallevenRegionEditor.css";

const PRESETS = [
  ["移除", "移除选中区域的内容，并根据周围画面自然补全"],
  ["替换", "将选中区域替换为："],
  ["修复", "修复选中区域的细节、边缘和纹理，保持整体风格一致"],
  ["重绘", "重新绘制选中区域，保持构图、光线和未选区域不变"],
];
const MAX_WORK_EDGE = 1600;

function canvasBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片处理失败")), type, quality);
  });
}

export function WallevenRegionEditor({
  sourceUrl,
  title = "AI 生成图片",
  modelLabel = "图片模型",
  busy = false,
  onClose,
  onSubmit,
}) {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const sourceBlobRef = useRef(null);
  const strokesRef = useRef([]);
  const redoRef = useRef([]);
  const activeStrokeRef = useRef(null);
  const [resolvedUrl, setResolvedUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("paint");
  const [brushSize, setBrushSize] = useState(72);
  const [prompt, setPrompt] = useState("");
  const [coverage, setCoverage] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setResolvedUrl("");
    setReady(false);
    setError("");
    fetchAuthenticatedMediaBlob(sourceUrl, { signal: controller.signal, cache: "default" })
      .then((blob) => {
        if (controller.signal.aborted) return;
        sourceBlobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch((caught) => {
        if (caught?.name !== "AbortError") setError(caught?.message || "图片读取失败");
      });
    return () => {
      controller.abort();
      sourceBlobRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
      if (!(event.metaKey || event.ctrlKey) || String(event.key).toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown, true);
    };
  });

  function initialize(event) {
    const image = event.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas || !image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(1, MAX_WORK_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    strokesRef.current = [];
    redoRef.current = [];
    setCoverage(0);
    setHistoryVersion((value) => value + 1);
    setReady(true);
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

  function drawStroke(context, stroke) {
    context.save();
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(71, 212, 142, 0.58)";
    context.fillStyle = context.strokeStyle;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    stroke.points.forEach((next, index) => {
      const previous = stroke.points[index - 1] || next;
      if (previous.x === next.x && previous.y === next.y) {
        context.beginPath();
        context.arc(next.x, next.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineTo(next.x, next.y);
        context.stroke();
      }
    });
    context.restore();
  }

  function render() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((stroke) => drawStroke(context, stroke));
  }

  function selectionBounds() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    let selected = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 12) continue;
        selected += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    setCoverage((selected / Math.max(1, canvas.width * canvas.height)) * 100);
    return selected ? { minX, minY, maxX, maxY } : null;
  }

  function start(event) {
    if (busy || event.button !== 0) return;
    const next = point(event);
    if (!next) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const stroke = { mode: event.altKey ? (mode === "paint" ? "erase" : "paint") : mode, size: brushSize, points: [next] };
    activeStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    redoRef.current = [];
    drawStroke(canvasRef.current.getContext("2d"), stroke);
    setHistoryVersion((value) => value + 1);
  }

  function move(event) {
    const stroke = activeStrokeRef.current;
    if (!stroke || busy) return;
    const next = point(event);
    const previous = stroke.points.at(-1);
    if (!next || (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < 1.2)) return;
    stroke.points.push(next);
    drawStroke(canvasRef.current.getContext("2d"), { ...stroke, points: [previous || next, next] });
  }

  function stop(event) {
    if (!activeStrokeRef.current) return;
    activeStrokeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    selectionBounds();
  }

  function undo() {
    if (busy || !strokesRef.current.length) return;
    redoRef.current = [...redoRef.current, strokesRef.current.at(-1)];
    strokesRef.current = strokesRef.current.slice(0, -1);
    render();
    selectionBounds();
    setHistoryVersion((value) => value + 1);
  }

  function redo() {
    if (busy || !redoRef.current.length) return;
    strokesRef.current = [...strokesRef.current, redoRef.current.at(-1)];
    redoRef.current = redoRef.current.slice(0, -1);
    render();
    selectionBounds();
    setHistoryVersion((value) => value + 1);
  }

  function clear() {
    if (busy || !strokesRef.current.length) return;
    redoRef.current = [...redoRef.current, ...strokesRef.current.slice().reverse()];
    strokesRef.current = [];
    render();
    setCoverage(0);
    setHistoryVersion((value) => value + 1);
  }

  async function buildPayload() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const bounds = selectionBounds();
    if (!canvas || !image || !bounds) throw new Error("请先涂抹需要编辑的区域");
    const padding = Math.max(24, brushSize, Math.round(Math.max(canvas.width, canvas.height) * 0.06));
    const workRect = {
      x: Math.max(0, bounds.minX - padding),
      y: Math.max(0, bounds.minY - padding),
      right: Math.min(canvas.width, bounds.maxX + padding + 1),
      bottom: Math.min(canvas.height, bounds.maxY + padding + 1),
    };
    const scaleX = image.naturalWidth / canvas.width;
    const scaleY = image.naturalHeight / canvas.height;
    const rect = {
      x: Math.floor(workRect.x * scaleX),
      y: Math.floor(workRect.y * scaleY),
      width: Math.max(1, Math.ceil((workRect.right - workRect.x) * scaleX)),
      height: Math.max(1, Math.ceil((workRect.bottom - workRect.y) * scaleY)),
    };
    rect.width = Math.min(rect.width, image.naturalWidth - rect.x);
    rect.height = Math.min(rect.height, image.naturalHeight - rect.y);

    const crop = document.createElement("canvas");
    crop.width = rect.width;
    crop.height = rect.height;
    crop.getContext("2d").drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

    const selection = document.createElement("canvas");
    selection.width = rect.width;
    selection.height = rect.height;
    selection.getContext("2d").drawImage(
      canvas,
      workRect.x,
      workRect.y,
      workRect.right - workRect.x,
      workRect.bottom - workRect.y,
      0,
      0,
      rect.width,
      rect.height,
    );
    const mask = document.createElement("canvas");
    mask.width = rect.width;
    mask.height = rect.height;
    const maskContext = mask.getContext("2d", { alpha: true });
    maskContext.fillStyle = "#fff";
    maskContext.fillRect(0, 0, rect.width, rect.height);
    maskContext.globalCompositeOperation = "destination-out";
    maskContext.drawImage(selection, 0, 0);

    const [cropBlob, maskBlob] = await Promise.all([canvasBlob(crop), canvasBlob(mask)]);
    crop.width = mask.width = selection.width = 1;
    crop.height = mask.height = selection.height = 1;
    return {
      prompt: prompt.trim(),
      cropFile: new File([cropBlob], `region-edit-${Date.now()}.png`, { type: "image/png" }),
      maskFile: new File([maskBlob], `region-mask-${Date.now()}.png`, { type: "image/png" }),
      baseFile: sourceBlobRef.current
        ? new File([sourceBlobRef.current], `region-base-${Date.now()}.${sourceBlobRef.current.type.includes("jpeg") ? "jpg" : sourceBlobRef.current.type.includes("webp") ? "webp" : "png"}`, { type: sourceBlobRef.current.type || "image/png" })
        : null,
      maskRect: `${rect.x},${rect.y},${rect.width},${rect.height}`,
    };
  }

  async function submit() {
    if (busy || !prompt.trim() || !strokesRef.current.length) return;
    try {
      setError("");
      await onSubmit?.(await buildPayload());
    } catch (caught) {
      setError(caught?.message || "局部编辑提交失败");
    }
  }

  return createPortal(
    <div className="walleven-region-editor" role="dialog" aria-modal="true" aria-label="图片局部编辑">
      <header className="walleven-region-editor__header">
        <div><span>REGION EDIT</span><strong>{title}</strong></div>
        <span className="walleven-region-editor__model"><i className="bi bi-cpu" />{modelLabel}</span>
        <button type="button" aria-label="关闭局部编辑" title="关闭" disabled={busy} onClick={onClose}><i className="bi bi-x-lg" /></button>
      </header>
      <main className="walleven-region-editor__main">
        <nav className="walleven-region-editor__tools" aria-label="蒙版工具">
          <button type="button" className={mode === "paint" ? "is-active" : ""} aria-label="画笔" title="画笔" onClick={() => setMode("paint")}><i className="bi bi-brush" /></button>
          <button type="button" className={mode === "erase" ? "is-active" : ""} aria-label="擦除" title="擦除" onClick={() => setMode("erase")}><i className="bi bi-eraser" /></button>
          <span />
          <button type="button" disabled={!strokesRef.current.length || busy} aria-label="撤销" title="撤销" onClick={undo}><i className="bi bi-arrow-counterclockwise" /></button>
          <button type="button" disabled={!redoRef.current.length || busy} aria-label="重做" title="重做" onClick={redo}><i className="bi bi-arrow-clockwise" /></button>
          <button type="button" disabled={!strokesRef.current.length || busy} aria-label="清除蒙版" title="清除" onClick={clear}><i className="bi bi-trash3" /></button>
        </nav>
        <section className="walleven-region-editor__stage" aria-label="局部编辑画布">
          {resolvedUrl && <div className="walleven-region-editor__artboard">
            <img ref={imageRef} src={resolvedUrl} alt={title} draggable="false" onLoad={initialize} />
            <canvas ref={canvasRef} aria-label="涂抹编辑区域" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
          </div>}
          {!resolvedUrl && !error && <div className="walleven-region-editor__loading"><span /><span /><span /></div>}
          <div className="walleven-region-editor__brush">
            <i className="bi bi-circle" />
            <input type="range" min="12" max="180" step="2" value={brushSize} aria-label="画笔大小" onChange={(event) => setBrushSize(Number(event.target.value))} />
            <output>{brushSize}</output>
          </div>
        </section>
        <aside className="walleven-region-editor__panel">
          <div className="walleven-region-editor__panel-title"><span>编辑描述</span><strong>{coverage > 0 ? `${coverage.toFixed(1)}%` : "未选择"}</strong></div>
          <textarea value={prompt} rows="8" maxLength="1200" placeholder="描述选中区域需要变成什么" onChange={(event) => setPrompt(event.target.value)} />
          <div className="walleven-region-editor__presets">
            {PRESETS.map(([label, text]) => <button key={label} type="button" onClick={() => setPrompt((current) => current.trim() ? `${current.trim()}\n${text}` : text)}>{label}</button>)}
          </div>
          {error && <p className="walleven-region-editor__error" role="alert">{error}</p>}
          <footer>
            <span>{prompt.length} / 1200</span>
            <button type="button" disabled={busy || !ready || !prompt.trim() || !strokesRef.current.length} onClick={() => void submit()}>
              <i className={`bi ${busy ? "bi-arrow-repeat spin" : "bi-stars"}`} />
              {busy ? "生成中" : "生成局部编辑"}
            </button>
          </footer>
        </aside>
      </main>
    </div>,
    document.body,
  );
}
