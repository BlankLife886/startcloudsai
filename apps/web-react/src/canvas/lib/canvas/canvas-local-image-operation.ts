import { MAX_UPSCALE_LONG_EDGE, type ImageCropRect, type ImageSplitParams, type ImageUpscaleParams } from "./canvas-image-data.ts";

import type { CanvasLocalImageOperation } from "../../types/canvas.ts";

const LOCAL_IMAGE_OPERATIONS = new Set<CanvasLocalImageOperation>(["crop", "split", "upscale"]);

export function isCanvasLocalImageOperation(value: unknown): value is CanvasLocalImageOperation {
    return typeof value === "string" && LOCAL_IMAGE_OPERATIONS.has(value as CanvasLocalImageOperation);
}

export function normalizeCanvasLocalImageOperationParams(operation: "crop", value: unknown): ImageCropRect;
export function normalizeCanvasLocalImageOperationParams(operation: "split", value: unknown): ImageSplitParams;
export function normalizeCanvasLocalImageOperationParams(operation: "upscale", value: unknown): ImageUpscaleParams;
export function normalizeCanvasLocalImageOperationParams(operation: CanvasLocalImageOperation, value: unknown): ImageCropRect | ImageSplitParams | ImageUpscaleParams;
export function normalizeCanvasLocalImageOperationParams(operation: CanvasLocalImageOperation, value: unknown): ImageCropRect | ImageSplitParams | ImageUpscaleParams {
    const params = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    if (operation === "crop") {
        const x = clamp(numberParam(params.x, 0), 0, 0.99);
        const y = clamp(numberParam(params.y, 0), 0, 0.99);
        return {
            x,
            y,
            width: clamp(numberParam(params.width, 1), 0.01, 1 - x),
            height: clamp(numberParam(params.height, 1), 0.01, 1 - y),
        };
    }
    if (operation === "split") {
        const horizontalLines = normalizeLines(params.horizontalLines);
        const verticalLines = normalizeLines(params.verticalLines);
        return {
            rows: horizontalLines.length ? horizontalLines.length + 1 : clampInteger(numberParam(params.rows, 2), 1, 12),
            columns: verticalLines.length ? verticalLines.length + 1 : clampInteger(numberParam(params.columns, 2), 1, 12),
            ...(horizontalLines.length ? { horizontalLines } : {}),
            ...(verticalLines.length ? { verticalLines } : {}),
        };
    }
    const algorithm = params.algorithm === "nearest" || params.algorithm === "bilinear" ? params.algorithm : "high";
    return {
        targetLongEdge: clampInteger(numberParam(params.targetLongEdge, 2048), 1, MAX_UPSCALE_LONG_EDGE),
        algorithm,
    };
}

export function canvasLocalImageOperationOutputCount(operation: CanvasLocalImageOperation, value: unknown) {
    if (operation !== "split") return 1;
    const params = normalizeCanvasLocalImageOperationParams("split", value);
    return params.rows * params.columns;
}

function normalizeLines(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((line) => Number.isFinite(line) && line > 0 && line < 1).map((line) => Math.round(line * 10_000) / 10_000))].sort((a, b) => a - b).slice(0, 11);
}

function numberParam(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number) {
    return Math.round(clamp(value, min, max));
}
