import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Camera, RotateCcw, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { CanvasEditorModal, EditorGhostButton, EditorPrimaryButton } from "./canvas-editor-modal";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

const defaultParams: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 9,
    cameraDistance: 4.8,
    wideAngle: false,
};

const horizontalRange = 60;
const pitchRange = 45;
const distanceMin = 1;
const distanceMax = 10;
const distancePresets = [
    { id: "near", value: 2, labelKey: "canvas.editors.angleNear" },
    { id: "mid", value: 4.8, labelKey: "canvas.editors.angleMid" },
    { id: "far", value: 8, labelKey: "canvas.editors.angleFar" },
] as const;

export function CanvasNodeAngleDialog({ dataUrl, open, initialParams, onClose, onConfirm }: { dataUrl: string; open: boolean; initialParams?: CanvasImageAngleParams; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void }) {
    const { t } = useTranslation();
    const stageRef = useRef<HTMLDivElement>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const [params, setParams] = useState(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const activeDistance = distancePresets.find((preset) => Math.abs(preset.value - params.cameraDistance) < 0.35)?.id;

    useEffect(() => {
        if (!open) return;
        setParams(initialParams ? { ...initialParams } : defaultParams);
        setImage(null);
        setDragging(false);
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, initialParams, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    const startOrbit = (event: ReactPointerEvent<HTMLElement>, source: "stage" | "compass") => {
        if (event.button !== 0) return;
        const box = (source === "compass" ? event.currentTarget : stageRef.current)?.getBoundingClientRect();
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        setDragging(true);
        const start = { x: event.clientX, y: event.clientY, ...params };

        const applyPoint = (clientX: number, clientY: number) => {
            if (source === "compass") {
                setParams((current) => ({ ...current, ...pointToAngle(clientX, clientY, box) }));
                return;
            }
            setParams((current) => ({
                ...current,
                horizontalAngle: clamp(start.horizontalAngle + ((clientX - start.x) / box.width) * horizontalRange * 2, -horizontalRange, horizontalRange),
                pitchAngle: clamp(start.pitchAngle + ((clientY - start.y) / box.height) * pitchRange * 2, -pitchRange, pitchRange),
            }));
        };

        const move = (next: PointerEvent) => applyPoint(next.clientX, next.clientY);
        const stop = () => {
            setDragging(false);
            controller.abort();
        };
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
        if (source === "compass") applyPoint(event.clientX, event.clientY);
    };

    const changeDistance = (event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setParams((current) => ({
            ...current,
            cameraDistance: clamp(current.cameraDistance + Math.sign(event.deltaY) * 0.3, distanceMin, distanceMax),
        }));
    };

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open && Boolean(dataUrl)}
            onClose={onClose}
            width="min(880px, 94vw)"
            title={t("canvas.editors.angleTitle")}
            hint={<div className="canvas-mask-shortcut">{t("canvas.editors.angleDrag")}</div>}
            meta={image ? `${image.width} × ${image.height}` : t("canvas.editors.loading")}
            icon={<Camera className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div
                    ref={stageRef}
                    className={`canvas-mask-stage relative grid h-[min(56vh,520px)] w-full place-items-center overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                    onPointerDown={(event) => startOrbit(event, "stage")}
                    onWheel={changeDistance}
                    onDoubleClick={() => setParams((current) => ({ ...current, horizontalAngle: defaultParams.horizontalAngle, pitchAngle: defaultParams.pitchAngle }))}
                >
                    <img src={dataUrl} alt="" className="pointer-events-none max-h-[72%] max-w-[72%] object-contain" draggable={false} style={{ transform: previewTransform(params) }} />
                    <div className="canvas-angle-pad" onPointerDown={(event) => startOrbit(event, "compass")}>
                        <span className="canvas-angle-pad-knob" style={knobStyle(params)} />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {distancePresets.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={`canvas-crop-ratio${activeDistance === preset.id ? " is-active" : ""}`}
                            onClick={() => update("cameraDistance", preset.value)}
                        >
                            {t(preset.labelKey)}
                        </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-current opacity-15" />
                    <button type="button" className={`canvas-crop-ratio${!params.wideAngle ? " is-active" : ""}`} onClick={() => update("wideAngle", false)}>
                        {t("canvas.editors.standard")}
                    </button>
                    <button type="button" className={`canvas-crop-ratio${params.wideAngle ? " is-active" : ""}`} onClick={() => update("wideAngle", true)}>
                        {t("canvas.editors.wide")}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 text-[12px] font-medium opacity-50">{formatAngleSummary(params, t)}</div>
                    <EditorGhostButton className="is-quiet" icon={<RotateCcw className="size-3.5" />} onClick={() => setParams(defaultParams)}>
                        {t("canvas.editors.reset")}
                    </EditorGhostButton>
                    <EditorPrimaryButton icon={<WandSparkles className="size-3.5" />} onClick={() => onConfirm(params)}>
                        {t("canvas.editors.aiGenerate")}
                    </EditorPrimaryButton>
                </div>
            </div>
        </CanvasEditorModal>
    );
}

function pointToAngle(clientX: number, clientY: number, box: DOMRect) {
    const nx = clamp(((clientX - box.left) / box.width) * 2 - 1, -1, 1);
    const ny = clamp(((clientY - box.top) / box.height) * 2 - 1, -1, 1);
    const length = Math.hypot(nx, ny);
    const x = length > 1 ? nx / length : nx;
    const y = length > 1 ? ny / length : ny;
    return {
        horizontalAngle: Math.round(x * horizontalRange),
        pitchAngle: Math.round(y * pitchRange),
    };
}

function knobStyle(params: CanvasImageAngleParams) {
    const inset = 14;
    return {
        left: `${inset + ((params.horizontalAngle / horizontalRange) * 0.5 + 0.5) * (100 - inset * 2)}%`,
        top: `${inset + ((params.pitchAngle / pitchRange) * 0.5 + 0.5) * (100 - inset * 2)}%`,
    };
}

function formatAngleSummary(params: CanvasImageAngleParams, t: (key: string, options?: Record<string, string | number>) => string) {
    const horizontal = params.horizontalAngle === 0 ? t("canvas.generation.front") : params.horizontalAngle > 0 ? t("canvas.generation.rotateRight", { angle: Math.round(params.horizontalAngle) }) : t("canvas.generation.rotateLeft", { angle: Math.abs(Math.round(params.horizontalAngle)) });
    const pitch = params.pitchAngle === 0 ? t("canvas.generation.level") : params.pitchAngle > 0 ? t("canvas.generation.topDown", { angle: Math.round(params.pitchAngle) }) : t("canvas.generation.lowAngle", { angle: Math.abs(Math.round(params.pitchAngle)) });
    return `${horizontal} · ${pitch} · ${params.cameraDistance.toFixed(1)} · ${t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard")}`;
}

function previewTransform(params: CanvasImageAngleParams) {
    const scale = 1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
    return `perspective(900px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${Math.max(0.72, Math.min(1.08, scale))})`;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
