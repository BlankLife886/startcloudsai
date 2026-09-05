import { useEffect, useMemo, useState } from "react";
import { ImagePlus, ZoomIn } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize, type ImageUpscaleAlgorithm, type ImageUpscaleParams } from "@/lib/canvas/canvas-image-data";
import { CanvasEditorModal, EditorPrimaryButton } from "./canvas-editor-modal";

export type CanvasImageUpscaleParams = ImageUpscaleParams;

const algorithms: ImageUpscaleAlgorithm[] = ["high", "bilinear", "nearest"];

const targetOptions = [
    { label: "1K", value: 1024 },
    { label: "2K", value: 2048 },
    { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
];

const defaultParams: CanvasImageUpscaleParams = {
    targetLongEdge: 2048,
    algorithm: "high",
};

export function CanvasNodeUpscaleDialog({ dataUrl, open, initialParams, onClose, onConfirm }: { dataUrl: string; open: boolean; initialParams?: CanvasImageUpscaleParams; onClose: () => void; onConfirm: (params: CanvasImageUpscaleParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState<CanvasImageUpscaleParams>(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const scale = image && outputSize ? Math.max(outputSize.width / image.width, outputSize.height / image.height) : 0;
    const canUpscale = Boolean(image && sourceLongEdge < params.targetLongEdge && params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE);
    const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);
    const scaleLabel = scale > 1 ? t("canvas.editors.scale", { value: scale >= 10 ? scale.toFixed(0) : scale.toFixed(1) }) : "";

    useEffect(() => {
        if (!open) return;
        setParams(initialParams ? { ...initialParams } : { ...defaultParams });
        setImage(null);
    }, [dataUrl, initialParams, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image || initialParams) return;
        const nextTarget = targetOptions.find((option) => sourceLongEdge < option.value)?.value || MAX_UPSCALE_LONG_EDGE;
        setParams((current) => ({ ...current, targetLongEdge: nextTarget }));
    }, [image, initialParams, sourceLongEdge]);

    return (
        <CanvasEditorModal
            className="canvas-mask-modal"
            open={open && Boolean(dataUrl)}
            onClose={onClose}
            width="min(880px, 94vw)"
            title={t("canvas.editors.upscaleTitle")}
            meta={image ? `${image.width} × ${image.height}` : t("canvas.editors.loading")}
            icon={<ZoomIn className="size-4" />}
        >
            <div className="flex flex-col gap-3">
                <div className="canvas-mask-stage relative grid h-[min(56vh,520px)] w-full place-items-center p-6">
                    <img src={dataUrl} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {targetOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            disabled={Boolean(image && sourceLongEdge >= option.value)}
                            className={`canvas-crop-ratio${params.targetLongEdge === option.value ? " is-active" : ""}`}
                            onClick={() => setParams((current) => ({ ...current, targetLongEdge: option.value }))}
                        >
                            {option.label}
                        </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-current opacity-15" />
                    {algorithms.map((algorithm) => (
                        <button
                            key={algorithm}
                            type="button"
                            title={t(`canvas.editors.${algorithm}Description`)}
                            className={`canvas-crop-ratio${params.algorithm === algorithm ? " is-active" : ""}`}
                            onClick={() => setParams((current) => ({ ...current, algorithm }))}
                        >
                            {t(`canvas.editors.${algorithm}`)}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-3">
                    <div className={`min-w-0 flex-1 text-[12px] font-medium tabular-nums ${image && !canUpscale ? "text-[#ef4444]" : "opacity-50"}`}>
                        {image && !canUpscale
                            ? reachedMax
                                ? t("canvas.editors.maxReached")
                                : t("canvas.editors.targetReached")
                            : outputSize
                              ? `${image?.width} × ${image?.height} → ${outputSize.width} × ${outputSize.height}${scaleLabel ? ` · ${scaleLabel}` : ""}`
                              : t("canvas.editors.loading")}
                    </div>
                    <EditorPrimaryButton icon={<ImagePlus className="size-3.5" />} disabled={!canUpscale} onClick={() => onConfirm(params)}>
                        {t("canvas.editors.upscale")}
                    </EditorPrimaryButton>
                </div>
            </div>
        </CanvasEditorModal>
    );
}
