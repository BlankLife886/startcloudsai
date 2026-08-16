import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Brush, Eraser, Redo2, RotateCcw, Undo2, WandSparkles, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import { readImageMeta } from "@/lib/image-utils";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { CanvasEditorModal, EditorIconButton, EditorPrimaryButton } from "./canvas-editor-modal";

export type CanvasImageMaskEditPayload = {
    prompt: string;
    maskDataUrl: string;
};

type DrawMode = "paint" | "erase";
type Point = { x: number; y: number };
type MaskStroke = { mode: DrawMode; size: number; points: Point[] };
type BrushPreview = { x: number; y: number; size: number; adjusting: boolean };

const defaultBrushSize = 100;
const maskFillColor = "rgba(37, 99, 235, .38)";

export function CanvasNodeMaskEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void }) {
    const { t } = useTranslation();
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<{ active: boolean; stroke: MaskStroke | null }>({ active: false, stroke: null });
    const brushAdjustRef = useRef<{ active: boolean; pointerId: number; startX: number; startSize: number; previewX: number; previewY: number } | null>(null);
    const historyRef = useRef<MaskStroke[]>([]);
    const redoRef = useRef<MaskStroke[]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [error, setError] = useState("");
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
    const viewport = useImageEditorViewport(image, open);

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setBrushSize(defaultBrushSize);
        setMode("paint");
        setError("");
        setHistorySize(0);
        setRedoSize(0);
        setBrushPreview(null);
        historyRef.current = [];
        redoRef.current = [];
        brushAdjustRef.current = null;
        drawingRef.current = { active: false, stroke: null };
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const maskCanvas = maskCanvasRef.current;
        const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
        const previewContext = previewCanvasRef.current?.getContext("2d");
        const stroke = drawingRef.current.stroke;
        if (!maskCanvas || !context || !previewContext || !stroke) return;
        configureStrokeContext(context, stroke);
        configurePreviewStrokeContext(previewContext, stroke);
        const last = stroke.points.at(-1);
        drawMaskStroke(context, last || point, point, stroke.size);
        drawMaskStroke(previewContext, last || point, point, stroke.size);
        stroke.points.push(point);
        if (stroke.mode === "paint") {
            setError("");
        }
    };

    const updateBrushPreview = (event: ReactPointerEvent<HTMLCanvasElement>, size = brushSize, adjusting = false) => {
        setBrushPreview({
            x: event.clientX,
            y: event.clientY,
            size,
            adjusting,
        });
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if ((event.button === 0 || event.button === 2) && event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            brushAdjustRef.current = {
                active: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startSize: brushSize,
                previewX: event.clientX,
                previewY: event.clientY,
            };
            updateBrushPreview(event, brushSize, true);
            return;
        }
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBrushPreview(event);
        drawingRef.current = { active: true, stroke: { mode: event.button === 2 ? "erase" : mode, size: brushSize, points: [] } };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            const nextSize = clampBrushSize(brushAdjust.startSize + event.clientX - brushAdjust.startX);
            setBrushSize(nextSize);
            setBrushPreview({
                x: brushAdjust.previewX,
                y: brushAdjust.previewY,
                size: nextSize,
                adjusting: true,
            });
            return;
        }
        updateBrushPreview(event);
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            brushAdjustRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            updateBrushPreview(event, brushSize);
            return;
        }
        const stroke = drawingRef.current.stroke;
        drawingRef.current = { active: false, stroke: null };
        if (stroke?.points.length) {
            historyRef.current.push(stroke);
            setHistorySize(historyRef.current.length);
            redoRef.current = [];
            setRedoSize(0);
        }
    };

    const undoMask = useCallback(() => {
        if (drawingRef.current.active || !historyRef.current.length) return;
        const stroke = historyRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const redoMask = useCallback(() => {
        if (drawingRef.current.active || !redoRef.current.length) return;
        const stroke = redoRef.current.pop();
        if (stroke) historyRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const resetMask = () => {
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        setError("");
    };

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const inField = Boolean(target?.closest("input,textarea,[contenteditable='true']"));
            const key = event.key.toLowerCase();
            const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
            const isUndo = modifier && !event.shiftKey && key === "z";
            const isRedo = modifier && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
            if (isUndo || isRedo) {
                if (inField) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (isRedo) redoMask();
                else undoMask();
                return;
            }
            if (inField) return;
            if (key === "b") {
                event.preventDefault();
                setMode("paint");
                return;
            }
            if (key === "e") {
                event.preventDefault();
                setMode("erase");
                return;
            }
            if (event.key === "[" || event.key === "【") {
                event.preventDefault();
                setBrushSize((current) => clampBrushSize(current - 8));
                return;
            }
            if (event.key === "]" || event.key === "】") {
                event.preventDefault();
                setBrushSize((current) => clampBrushSize(current + 8));
            }
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [open, redoMask, undoMask]);

    const submit = () => {
        const nextPrompt = prompt.trim();
        const canvas = maskCanvasRef.current;
        if (!nextPrompt) return setError(t("canvas.editors.maskPromptRequired"));
        if (!canvas) return;
        if (!canvasHasPaint(canvas)) return setError(t("canvas.editors.maskRequired"));
        onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(canvas) });
    };

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open && Boolean(dataUrl)}
            onClose={onClose}
            width="min(1100px, 94vw)"
            title={t("canvas.editors.maskTitle")}
            hint={
                <div className={`canvas-mask-shortcut${viewport.spacePressed || viewport.isPanning ? " is-active" : ""}`}>
                    <kbd>{t("canvas.editors.panKey")}</kbd>
                    <span>{t("canvas.editors.panHint")}</span>
                </div>
            }
            meta={image ? `${image.width} × ${image.height}` : t("canvas.editors.loading")}
            icon={<Brush className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div className="canvas-mask-stage relative h-[min(64vh,680px)] w-full">
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        className={`absolute inset-x-0 top-0 bottom-[52px] ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                    >
                    <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            {image ? (
                                <>
                                    <canvas ref={maskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                    <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                        <img src={dataUrl} alt="" className="absolute inset-0 block h-full w-full bg-transparent object-contain" draggable={false} />
                                        <canvas
                                            ref={previewCanvasRef}
                                            width={image.width}
                                            height={image.height}
                                            className="absolute inset-0 h-full w-full cursor-none touch-none"
                                            onPointerDown={startDraw}
                                            onPointerMove={moveDraw}
                                            onPointerUp={stopDraw}
                                            onPointerCancel={stopDraw}
                                            onPointerEnter={(event) => updateBrushPreview(event)}
                                            onPointerLeave={() => {
                                                if (!drawingRef.current.active && !brushAdjustRef.current?.active) setBrushPreview(null);
                                            }}
                                            onContextMenu={(event) => event.preventDefault()}
                                        />
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </div>
                    </div>
                    <div className="canvas-mask-tools" data-click-guard="off">
                        <button type="button" className={`canvas-mask-tool${mode === "paint" ? " is-active" : ""}`} title={t("canvas.editors.brushTitle")} onClick={() => setMode("paint")}>
                            <Brush className="size-3.5" />
                            {t("canvas.editors.brush")}
                        </button>
                        <button type="button" className={`canvas-mask-tool${mode === "erase" ? " is-active" : ""}`} title={t("canvas.editors.eraseTitle")} onClick={() => setMode("erase")}>
                            <Eraser className="size-3.5" />
                            {t("canvas.editors.erase")}
                        </button>
                        <span className="canvas-mask-tools-divider" />
                        <input
                            className="canvas-editor-range"
                            type="range"
                            min={8}
                            max={160}
                            step={2}
                            value={brushSize}
                            title={t("canvas.editors.brushSize")}
                            onChange={(event) => setBrushSize(Number(event.target.value))}
                        />
                        <span className="min-w-10 text-center text-[11px] font-semibold tabular-nums text-white/70">{brushSize}</span>
                        <span className="canvas-mask-tools-divider" />
                        <EditorIconButton title={t("canvas.editors.undoMaskTitle")} disabled={!historySize} onClick={undoMask}>
                            <Undo2 className="size-3.5" />
                        </EditorIconButton>
                        <EditorIconButton title={t("canvas.editors.redoMaskTitle")} disabled={!redoSize} onClick={redoMask}>
                            <Redo2 className="size-3.5" />
                        </EditorIconButton>
                        <EditorIconButton title={t("canvas.editors.resetMaskTitle")} disabled={!historySize} onClick={resetMask}>
                            <RotateCcw className="size-3.5" />
                        </EditorIconButton>
                        <span className="canvas-mask-tools-divider" />
                        <EditorIconButton title={t("canvas.editors.zoomOut")} disabled={!viewport.canZoomOut} onClick={viewport.zoomOut}>
                            <ZoomOut className="size-3.5" />
                        </EditorIconButton>
                        <button type="button" className="min-w-11 px-1 text-center text-[11px] font-semibold tabular-nums text-white/70" onClick={viewport.resetZoom}>
                            {Math.round(viewport.zoom * 100)}%
                        </button>
                        <EditorIconButton title={t("canvas.editors.zoomIn")} disabled={!viewport.canZoomIn} onClick={viewport.zoomIn}>
                            <ZoomIn className="size-3.5" />
                        </EditorIconButton>
                    </div>
                </div>
                {brushPreview
                    ? createPortal(
                          <div
                              className={`pointer-events-none fixed z-[20000] rounded-full border-2 ${brushPreview.adjusting ? "border-[#fbbf24] bg-black/10" : "border-white/90 bg-black/5"} shadow-[0_0_0_1px_rgba(0,0,0,.8)]`}
                              style={{ left: brushPreview.x, top: brushPreview.y, width: Math.max(4, brushPreview.size * viewport.imageScale), aspectRatio: 1, transform: "translate(-50%, -50%)" }}
                          >
                              {brushPreview.adjusting ? <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">{brushSize}px</span> : null}
                          </div>,
                          getCanvasPortalRoot(),
                      )
                    : null}

                {error ? <div className="text-[12px] font-medium text-[#ef4444]">{error}</div> : null}

                <div className="canvas-mask-composer">
                    <textarea
                        rows={2}
                        value={prompt}
                        placeholder={t("canvas.editors.maskPlaceholder")}
                        className="canvas-mask-prompt"
                        onChange={(event) => {
                            setPrompt(event.target.value);
                            setError("");
                        }}
                        onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                event.preventDefault();
                                submit();
                            }
                        }}
                    />
                    <EditorPrimaryButton icon={<WandSparkles className="size-3.5" />} onClick={submit}>
                        {t("canvas.editors.aiEdit")}
                    </EditorPrimaryButton>
                </div>
            </div>
        </CanvasEditorModal>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clampBrushSize(value: number) {
    return Math.min(160, Math.max(8, Math.round(value / 2) * 2));
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
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

function configureStrokeContext(context: CanvasRenderingContext2D, stroke: MaskStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
}

function configurePreviewStrokeContext(context: CanvasRenderingContext2D, stroke: MaskStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = maskFillColor;
    context.fillStyle = maskFillColor;
}

function replayMask(strokes: MaskStroke[], maskCanvas: HTMLCanvasElement | null, previewCanvas: HTMLCanvasElement | null) {
    const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
    const previewContext = previewCanvas?.getContext("2d");
    if (!maskCanvas || !context || !previewCanvas || !previewContext) return;
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    for (const stroke of strokes) {
        configureStrokeContext(context, stroke);
        configurePreviewStrokeContext(previewContext, stroke);
        stroke.points.forEach((point, index) => {
            const previous = stroke.points[index - 1] || point;
            drawMaskStroke(context, previous, point, stroke.size);
            drawMaskStroke(previewContext, previous, point, stroke.size);
        });
    }
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function buildEditMask(selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return selectionCanvas.toDataURL("image/png");
    const selectionContext = selectionCanvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!selectionContext) return canvas.toDataURL("image/png");
    const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < mask.data.length; index += 4) {
        if (selection.data[index] > 0) mask.data[index] = 0;
    }
    context.putImageData(mask, 0, 0);
    return canvas.toDataURL("image/png");
}
