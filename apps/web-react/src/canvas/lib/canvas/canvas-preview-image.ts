import { isLocalImageKey, isRemoteOriginalSource } from "@/lib/canvas/canvas-preview-url";
import { getImageBlob } from "@/services/image-storage";

export const CANVAS_PREVIEW_MIN_EDGE = 160;
export const CANVAS_PREVIEW_MAX_EDGE = 384;
export const CANVAS_PREVIEW_QUALITY = 0.5;
export const CANVAS_PREVIEW_TYPE = "image/webp";
export const CANVAS_PREVIEW_CACHE_LIMIT = 48;

let liveScale = 1;
const scaleListeners = new Set<() => void>();

export function setCanvasPreviewScale(scale: number) {
    const next = Number.isFinite(scale) ? scale : 1;
    if (Math.abs(liveScale - next) < 0.03) return;
    liveScale = next;
    scaleListeners.forEach((listener) => listener());
}

export function subscribeCanvasPreviewScale(listener: () => void) {
    scaleListeners.add(listener);
    return () => {
        scaleListeners.delete(listener);
    };
}

export function previewEdgeForScale(scale: number, maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    const edge = scale < 0.18 ? 160 : scale < 0.4 ? 256 : CANVAS_PREVIEW_MAX_EDGE;
    return clampPreviewEdge(Math.min(maxEdge, edge));
}

export function getCanvasPreviewEdge(maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    return previewEdgeForScale(liveScale, maxEdge);
}

const inflight = new Map<string, Promise<string | undefined>>();
const blobUrls = new Map<string, string>();
const recent = new Set<string>();
const MAX_DOWNSCALE_JOBS = 2;
let activeJobs = 0;
const downscaleQueue: Array<() => void> = [];

function runDownscaleJob<T>(work: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
        const start = () => {
            activeJobs += 1;
            work().then(resolve, reject).finally(() => {
                activeJobs -= 1;
                downscaleQueue.shift()?.();
            });
        };
        if (activeJobs < MAX_DOWNSCALE_JOBS) start();
        else downscaleQueue.push(start);
    });
}

function cacheKey(src: string, maxEdge: number) {
    return `${src}#webp=${maxEdge}@${CANVAS_PREVIEW_QUALITY}`;
}

async function loadPreviewBlob(src: string) {
    if (isRemoteOriginalSource(src)) return;
    if (isLocalImageKey(src)) return (await getImageBlob(src)) || undefined;
    const response = await fetch(src, { cache: "force-cache", credentials: src.startsWith("blob:") || src.startsWith("data:") ? "omit" : "include" });
    if (!response.ok) throw new Error(`Preview image fetch failed: ${response.status}`);
    return response.blob();
}

async function decodePreviewBitmap(blob: Blob, edge: number) {
    const bitmap = await createImageBitmap(blob);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= edge) return bitmap;
    const scale = edge / longEdge;
    const next = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: "medium",
    });
    bitmap.close();
    return next;
}

function encodePreviewBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((webp) => {
            if (webp) {
                resolve(webp);
                return;
            }
            canvas.toBlob(resolve, "image/jpeg", CANVAS_PREVIEW_QUALITY);
        }, CANVAS_PREVIEW_TYPE, CANVAS_PREVIEW_QUALITY);
    });
}

function touch(key: string) {
    recent.delete(key);
    recent.add(key);
}

function evict() {
    while (recent.size > CANVAS_PREVIEW_CACHE_LIMIT) {
        const oldest = recent.keys().next().value;
        if (!oldest) return;
        recent.delete(oldest);
        inflight.delete(oldest);
        const url = blobUrls.get(oldest);
        if (url) URL.revokeObjectURL(url);
        blobUrls.delete(oldest);
    }
}

export function clampPreviewEdge(maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    return Math.min(CANVAS_PREVIEW_MAX_EDGE, Math.max(CANVAS_PREVIEW_MIN_EDGE, Math.round(maxEdge)));
}

const failedSources = new Set<string>();

export async function buildLightweightPreview(src: string, maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    if (!src || src.startsWith("data:image/svg") || isRemoteOriginalSource(src) || failedSources.has(src)) return;
    const edge = clampPreviewEdge(maxEdge);
    const key = cacheKey(src, edge);
    const cached = blobUrls.get(key);
    if (cached) {
        touch(key);
        return cached;
    }
    const pending = inflight.get(key);
    if (pending) return pending;

    const task = runDownscaleJob(async () => {
        const blob = await loadPreviewBlob(src);
        if (!blob) return;
        const bitmap = await decodePreviewBitmap(blob, edge);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, bitmap.width);
        canvas.height = Math.max(1, bitmap.height);
        const keepAlpha = blob.type === "image/png" || blob.type === "image/webp";
        const context = canvas.getContext("2d", { alpha: keepAlpha });
        if (!context) {
            bitmap.close();
            return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "medium";
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const preview = await encodePreviewBlob(canvas);
        canvas.width = 0;
        canvas.height = 0;
        if (!preview) return;
        const url = URL.createObjectURL(preview);
        blobUrls.set(key, url);
        touch(key);
        evict();
        return url;
    }).catch((error) => {
        inflight.delete(key);
        failedSources.add(src);
        console.warn("[CanvasPreviewImage] failed to build lightweight preview", error);
        return undefined;
    });

    inflight.set(key, task);
    evict();
    return task;
}

export function shouldDownscalePreview(src: string) {
    return Boolean(src) && !src.startsWith("data:image/svg") && !isRemoteOriginalSource(src);
}

export function clearPreviewCache() {
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.clear();
    recent.clear();
    inflight.clear();
    failedSources.clear();
}
