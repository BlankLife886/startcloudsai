import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crop, Check, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { readImageMeta } from "@/lib/image-utils";
import { CanvasEditorModal, EditorGhostButton, EditorIconButton, EditorPrimaryButton } from "./canvas-editor-modal";

export type CanvasImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DragMode = "move" | "resize";
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minSize = 0.06;
const defaultCrop = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
export function CanvasNodeCropDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (crop: CanvasImageCropRect) => void }) {
    const { t } = useTranslation();
    const [crop, setCrop] = useState<CanvasImageCropRect>(defaultCrop);
    const [ratioPreset, setRatioPreset] = useState("free");
    const [fixedRatio, setFixedRatio] = useState<number | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const viewport = useImageEditorViewport(image, open);
    const boxRef = viewport.stageRef;
    const cropSize = image ? { width: Math.max(1, Math.round(crop.width * image.width)), height: Math.max(1, Math.round(crop.height * image.height)) } : null;

    useEffect(() => {
        if (open) {
            setCrop(defaultCrop);
            setRatioPreset("free");
            setFixedRatio(null);
        }
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const startDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, crop };
        const move = (event: PointerEvent) => {
            const dx = (event.clientX - start.x) / box.width;
            const dy = (event.clientY - start.y) / box.height;
            setCrop(mode === "move" ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, dx, dy, handle || "se", resolveRatio(ratioPreset, image, fixedRatio), box));
        };
        const stop = () => controller.abort();
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
    };

    const applyRatio = (value: string) => {
        setRatioPreset(value);
        const currentRatio = image ? (crop.width * image.width) / Math.max(1, crop.height * image.height) : null;
        const nextFixedRatio = value === "fixed" ? currentRatio : null;
        setFixedRatio(nextFixedRatio);
        const ratio = resolveRatio(value, image, nextFixedRatio);
        if (ratio && image) setCrop((current) => fitCropToRatio(current, ratio, image));
    };

    const resetCrop = () => {
        setCrop(defaultCrop);
        setRatioPreset("free");
        setFixedRatio(null);
    };

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open && Boolean(dataUrl)}
            onClose={onClose}
            width="min(1100px, 94vw)"
            title={t("canvas.editors.cropTitle")}
            hint={
                <div className={`canvas-mask-shortcut${viewport.spacePressed || viewport.isPanning ? " is-active" : ""}`}>
                    <kbd>{t("canvas.editors.panKey")}</kbd>
                    <span>{t("canvas.editors.panHint")}</span>
                </div>
            }
            meta={image ? `${image.width} × ${image.height}` : t("canvas.editors.loading")}
            icon={<Crop className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div className="canvas-mask-stage relative h-[min(64vh,680px)] w-full">
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        className={`absolute inset-x-0 top-0 bottom-[52px] ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                    >
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={boxRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                                <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                    <img src={dataUrl} alt="" className="block h-full w-full object-contain" draggable={false} />
                                </div>
                                <CropMask crop={crop} />
                                <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)]" style={cropStyle(crop)} onPointerDown={(event) => startDrag("move", event)}>
                                    <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/40" />
                                    <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/40" />
                                    <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/40" />
                                    <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/40" />
                                    {handles.map((handle) => (
                                        <button
                                            key={handle}
                                            type="button"
                                            className="absolute size-3 rounded-full border border-black/40 bg-white"
                                            style={handleStyle(handle)}
                                            onPointerDown={(event) => startDrag("resize", event, handle)}
                                            aria-label={t("canvas.editors.adjustCrop")}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="canvas-mask-tools" data-click-guard="off">
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

                <div className="flex flex-wrap items-center gap-1.5">
                    {(
                        [
                            { label: t("canvas.editors.free"), value: "free" },
                            { label: t("canvas.editors.fixed"), value: "fixed" },
                            { label: t("canvas.editors.originalMode"), value: "original" },
                            { label: "1:1", value: "1:1" },
                            { label: "4:3", value: "4:3" },
                            { label: "16:9", value: "16:9" },
                            { label: "9:16", value: "9:16" },
                        ] as const
                    ).map((option) => (
                        <button key={option.value} type="button" className={`canvas-crop-ratio${ratioPreset === option.value ? " is-active" : ""}`} onClick={() => applyRatio(option.value)}>
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 text-[12px] font-medium tabular-nums opacity-50">
                        {cropSize ? `${cropSize.width} × ${cropSize.height}` : t("canvas.editors.loading")}
                        {cropSize ? <span className="ml-2 opacity-70">{formatRatio(cropSize.width, cropSize.height)}</span> : null}
                    </div>
                    <EditorGhostButton className="is-quiet" icon={<RotateCcw className="size-3.5" />} onClick={resetCrop}>
                        {t("canvas.editors.reset")}
                    </EditorGhostButton>
                    <EditorPrimaryButton icon={<Check className="size-3.5" />} onClick={() => onConfirm(crop)}>
                        {t("canvas.editors.confirmCrop")}
                    </EditorPrimaryButton>
                </div>
            </div>
        </CanvasEditorModal>
    );
}

function CropMask({ crop }: { crop: CanvasImageCropRect }) {
    return (
        <>
            <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${crop.y * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
            <div className="absolute bg-black/55" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        </>
    );
}

function moveCrop(crop: CanvasImageCropRect, dx: number, dy: number): CanvasImageCropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

function resizeCrop(crop: CanvasImageCropRect, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, box: DOMRect): CanvasImageCropRect {
    let next = { ...crop };
    if (handle.includes("e")) next.width = crop.width + dx;
    if (handle.includes("s")) next.height = crop.height + dy;
    if (handle.includes("w")) {
        next.x = crop.x + dx;
        next.width = crop.width - dx;
    }
    if (handle.includes("n")) {
        next.y = crop.y + dy;
        next.height = crop.height - dy;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const horizontalOnly = (handle.includes("e") || handle.includes("w")) && !handle.includes("n") && !handle.includes("s");
        const useWidth = horizontalOnly || (handle.length > 1 && Math.abs(dx * box.width) >= Math.abs(dy * box.height));
        if (useWidth) next.height = next.width / normalizedRatio;
        else next.width = next.height * normalizedRatio;
        if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
        if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const scaleDown = Math.min(1, 1 / Math.max(next.width, 0.001), 1 / Math.max(next.height, 0.001));
        next.width *= scaleDown;
        next.height *= scaleDown;
        if (next.width < minSize || next.height < minSize) {
            const minimumScale = Math.max(minSize / Math.max(next.width, 0.001), minSize / Math.max(next.height, 0.001));
            next.width *= minimumScale;
            next.height *= minimumScale;
        }
        next.width = Math.min(next.width, next.height * normalizedRatio);
        next.height = next.width / normalizedRatio;
    } else {
        next.width = clamp(next.width, minSize, 1);
        next.height = clamp(next.height, minSize, 1);
    }
    next.x = clamp(next.x, 0, 1 - next.width);
    next.y = clamp(next.y, 0, 1 - next.height);
    return next;
}

function resolveRatio(preset: string, image: { width: number; height: number } | null, fixedRatio: number | null) {
    if (preset === "free" || !image) return null;
    if (preset === "fixed") return fixedRatio;
    if (preset === "original") return image.width / image.height;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function fitCropToRatio(crop: CanvasImageCropRect, ratio: number, image: { width: number; height: number }): CanvasImageCropRect {
    const normalizedRatio = ratio * (image.height / image.width);
    let width = crop.width;
    let height = width / normalizedRatio;
    if (height > crop.height) {
        height = crop.height;
        width = height * normalizedRatio;
    }
    if (width > 1) {
        width = 1;
        height = width / normalizedRatio;
    }
    if (height > 1) {
        height = 1;
        width = height * normalizedRatio;
    }
    return {
        x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
        y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
        width,
        height,
    };
}

function cropStyle(crop: CanvasImageCropRect) {
    return { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${handle}-resize` };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function formatRatio(width: number, height: number) {
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}
