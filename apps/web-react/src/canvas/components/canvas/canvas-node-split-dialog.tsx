import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grid2x2, ListRestart, Minus, PanelTop, Plus, Redo2, Rows3, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { CanvasEditorModal, EditorIconButton, EditorPrimaryButton } from "./canvas-editor-modal";

export type CanvasImageSplitParams = ImageSplitParams;

const defaultParams: CanvasImageSplitParams = { rows: 2, columns: 2, horizontalLines: [0.5], verticalLines: [0.5] };
const maxGridSize = 12;
type ActiveLine = { axis: "horizontal" | "vertical"; index: number } | null;

export function CanvasNodeSplitDialog({ dataUrl, open, initialParams, onClose, onConfirm }: { dataUrl: string; open: boolean; initialParams?: CanvasImageSplitParams; onClose: () => void; onConfirm: (params: CanvasImageSplitParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [active, setActive] = useState<ActiveLine>(null);
    const historyRef = useRef<CanvasImageSplitParams[]>([]);
    const redoRef = useRef<CanvasImageSplitParams[]>([]);
    const dragAbortRef = useRef<AbortController | null>(null);
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const viewport = useImageEditorViewport(image, open);
    const previewRef = viewport.stageRef;
    const horizontalLines = params.horizontalLines || [];
    const verticalLines = params.verticalLines || [];
    const rows = horizontalLines.length + 1;
    const columns = verticalLines.length + 1;
    const total = rows * columns;
    const pieceSize = image ? { width: Math.max(1, Math.floor(image.width / columns)), height: Math.max(1, Math.floor(image.height / rows)) } : null;

    useEffect(() => {
        if (!open) return;
        setParams(initialParams ? cloneSplitParams(initialParams) : defaultParams);
        setActive(null);
        setImage(null);
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
    }, [dataUrl, initialParams, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const update = (key: "rows" | "columns", value: string | number | null) => {
        const count = clampGrid(value ?? params[key]);
        pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
        setActive(null);
        setParams((current) => ({ ...current, [key]: count, [key === "rows" ? "horizontalLines" : "verticalLines"]: buildGridLines(count) }));
    };
    const addLine = (axis: "horizontal" | "vertical") => {
        pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
        const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
        const spot = findLineSpot(params[key] || []);
        const lines = [...(params[key] || []), spot].sort((a, b) => a - b);
        setActive({ axis, index: lines.indexOf(spot) });
        setParams({ ...params, [key]: lines, rows: axis === "horizontal" ? lines.length + 1 : params.rows, columns: axis === "vertical" ? lines.length + 1 : params.columns });
    };
    const deleteLine = () => {
        if (!active) return;
        pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
        setParams((current) => {
            const key = active.axis === "horizontal" ? "horizontalLines" : "verticalLines";
            const lines = (current[key] || []).filter((_, index) => index !== active.index);
            return { ...current, [key]: lines, rows: active.axis === "horizontal" ? lines.length + 1 : current.rows, columns: active.axis === "vertical" ? lines.length + 1 : current.columns };
        });
        setActive(null);
    };
    const startDrag = (axis: "horizontal" | "vertical", index: number, event: ReactPointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setActive({ axis, index });
        const box = previewRef.current?.getBoundingClientRect();
        if (!box) return;
        pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const move = (moveEvent: PointerEvent) => setLine(axis, index, axis === "horizontal" ? (moveEvent.clientY - box.top) / box.height : (moveEvent.clientX - box.left) / box.width);
        const stop = () => controller.abort();
        window.addEventListener("pointermove", move, { signal: controller.signal });
        window.addEventListener("pointerup", stop, { signal: controller.signal });
        window.addEventListener("pointercancel", stop, { signal: controller.signal });
    };
    const setLine = (axis: "horizontal" | "vertical", index: number, value: number) => {
        setParams((current) => {
            const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
            const lines = [...(current[key] || [])];
            lines[index] = clampLine(value, lines[index - 1] ?? 0, lines[index + 1] ?? 1);
            return { ...current, [key]: lines };
        });
    };
    const resetLines = () => {
        pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
        setActive(null);
        setParams((current) => ({ ...current, horizontalLines: buildGridLines(current.rows), verticalLines: buildGridLines(current.columns) }));
    };
    const undoSplit = useCallback(() => {
        const previous = historyRef.current.pop();
        if (!previous) return;
        redoRef.current.push(cloneSplitParams(params));
        setParams(previous);
        setActive(null);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
    }, [params]);
    const redoSplit = useCallback(() => {
        const next = redoRef.current.pop();
        if (!next) return;
        historyRef.current.push(cloneSplitParams(params));
        setParams(next);
        setActive(null);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
    }, [params]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            const key = event.key.toLowerCase();
            const isUndo = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "z";
            const isRedo = (event.metaKey || event.ctrlKey) && !event.altKey && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
            const isDelete = event.key === "Delete" || event.key === "Backspace";
            if (!isUndo && !isRedo && !isDelete) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isDelete) deleteLine();
            else if (isRedo) redoSplit();
            else undoSplit();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [active, open, params, redoSplit, undoSplit]);
    const confirmParams = { ...params, horizontalLines, verticalLines, rows, columns };

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open && Boolean(dataUrl)}
            onClose={onClose}
            width="min(1100px, 94vw)"
            title={t("canvas.editors.splitTitle")}
            hint={
                <div className={`canvas-mask-shortcut${viewport.spacePressed || viewport.isPanning ? " is-active" : ""}`}>
                    <kbd>{t("canvas.editors.panKey")}</kbd>
                    <span>{t("canvas.editors.panHint")}</span>
                </div>
            }
            meta={image ? `${image.width} × ${image.height}` : t("canvas.editors.loading")}
            icon={<Grid2x2 className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div className="canvas-mask-stage relative h-[min(64vh,680px)] w-full">
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        className={`absolute inset-x-0 top-0 bottom-[52px] ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                    >
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={previewRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                                <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                    <img src={dataUrl} alt="" className="block h-full w-full object-contain" draggable={false} />
                                </div>
                                <SplitGrid horizontalLines={horizontalLines} verticalLines={verticalLines} active={active} onPointerDown={startDrag} />
                            </div>
                        </div>
                    </div>
                    <div className="canvas-mask-tools" data-click-guard="off">
                        <EditorIconButton title={t("canvas.editors.undoSplitTitle")} disabled={!historySize} onClick={undoSplit}>
                            <Undo2 className="size-3.5" />
                        </EditorIconButton>
                        <EditorIconButton title={t("canvas.editors.redoSplitTitle")} disabled={!redoSize} onClick={redoSplit}>
                            <Redo2 className="size-3.5" />
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
                        <span className="canvas-mask-tools-divider" />
                        <button type="button" className="canvas-mask-tool" title={t("canvas.editors.horizontalLine")} disabled={rows >= maxGridSize} onClick={() => addLine("horizontal")}>
                            <Rows3 className="size-3.5" />
                            {t("canvas.editors.horizontalLine")}
                        </button>
                        <button type="button" className="canvas-mask-tool" title={t("canvas.editors.verticalLine")} disabled={columns >= maxGridSize} onClick={() => addLine("vertical")}>
                            <PanelTop className="size-3.5 rotate-90" />
                            {t("canvas.editors.verticalLine")}
                        </button>
                        <EditorIconButton title={t("canvas.editors.deleteLine")} disabled={!active} onClick={deleteLine}>
                            <Trash2 className="size-3.5" />
                        </EditorIconButton>
                        <EditorIconButton title={t("canvas.editors.resetLines")} onClick={resetLines}>
                            <ListRestart className="size-3.5" />
                        </EditorIconButton>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <SplitStepper label={t("canvas.editors.rows")} value={rows} onChange={(value) => update("rows", value)} />
                    <SplitStepper label={t("canvas.editors.columns")} value={columns} onChange={(value) => update("columns", value)} />
                    <div className="min-w-0 flex-1 text-[12px] font-medium tabular-nums opacity-50">
                        {t("canvas.editors.pieces", { count: total })}
                        {pieceSize ? <span className="ml-2 opacity-70">{pieceSize.width} × {pieceSize.height}</span> : null}
                    </div>
                    <EditorPrimaryButton icon={<Grid2x2 className="size-3.5" />} onClick={() => onConfirm(confirmParams)}>
                        {t("canvas.editors.generateChildren")}
                    </EditorPrimaryButton>
                </div>
            </div>
        </CanvasEditorModal>
    );
}

function SplitStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <div className="canvas-split-stepper">
            <span>{label}</span>
            <button type="button" disabled={value <= 1} aria-label="-" onClick={() => onChange(value - 1)}>
                <Minus className="size-3.5" />
            </button>
            <strong>{value}</strong>
            <button type="button" disabled={value >= maxGridSize} aria-label="+" onClick={() => onChange(value + 1)}>
                <Plus className="size-3.5" />
            </button>
        </div>
    );
}

function SplitGrid({ horizontalLines, verticalLines, active, onPointerDown }: { horizontalLines: number[]; verticalLines: number[]; active: ActiveLine; onPointerDown: (axis: "horizontal" | "vertical", index: number, event: ReactPointerEvent) => void }) {
    return (
        <div className="pointer-events-none absolute inset-0">
            {verticalLines.map((line, index) => (
                <div key={`column-${index}`} className="pointer-events-auto absolute inset-y-0 -ml-2 w-4 cursor-ew-resize" style={{ left: `${line * 100}%` }} onPointerDown={(event) => onPointerDown("vertical", index, event)}>
                    <div className={`absolute left-1/2 top-0 h-full border-l shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "vertical" && active.index === index ? "border-amber-300" : "border-white/90"}`} />
                </div>
            ))}
            {horizontalLines.map((line, index) => (
                <div key={`row-${index}`} className="pointer-events-auto absolute inset-x-0 -mt-2 h-4 cursor-ns-resize" style={{ top: `${line * 100}%` }} onPointerDown={(event) => onPointerDown("horizontal", index, event)}>
                    <div className={`absolute left-0 top-1/2 w-full border-t shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "horizontal" && active.index === index ? "border-amber-300" : "border-white/90"}`} />
                </div>
            ))}
        </div>
    );
}

function buildGridLines(count: number) {
    return Array.from({ length: Math.max(1, count) - 1 }, (_, index) => (index + 1) / count);
}

function findLineSpot(lines: number[]) {
    const cuts = [0, ...lines, 1].sort((a, b) => a - b);
    let spot = 0.5;
    let max = 0;
    for (let index = 0; index < cuts.length - 1; index += 1) {
        const gap = cuts[index + 1] - cuts[index];
        if (gap > max) {
            max = gap;
            spot = cuts[index] + gap / 2;
        }
    }
    return spot;
}

function clampLine(value: number, min: number, max: number) {
    return Math.min(max - 0.01, Math.max(min + 0.01, value));
}

function clampGrid(value: string | number) {
    const numberValue = Number(value);
    return Math.min(maxGridSize, Math.max(1, Math.round(Number.isFinite(numberValue) ? numberValue : 1)));
}

function cloneSplitParams(params: CanvasImageSplitParams) {
    return {
        ...params,
        horizontalLines: [...(params.horizontalLines || [])],
        verticalLines: [...(params.verticalLines || [])],
    };
}

function pushHistory(historyRef: { current: CanvasImageSplitParams[] }, redoRef: { current: CanvasImageSplitParams[] }, params: CanvasImageSplitParams, setHistorySize: (size: number) => void, setRedoSize: (size: number) => void) {
    historyRef.current.push(cloneSplitParams(params));
    if (historyRef.current.length > 50) historyRef.current.shift();
    redoRef.current = [];
    setHistorySize(historyRef.current.length);
    setRedoSize(0);
}
